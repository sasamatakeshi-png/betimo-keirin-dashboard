"""AI 分析サービス（Anthropic Claude）。

- ANTHROPIC_API_KEY が無い場合は AnalysisUnavailable を送出（呼び出し側で 503）。
- 対象 entity の集計データを取得 → プロンプト合成 → Claude 実行 → analysis_results へ保存。
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import (
    AnalysisResult,
    AnalysisTemplate,
    Event,
    LatestMetricValue,
    Video,
)

DEFAULT_TONE = "分析重視"
DEFAULT_LENGTH = "medium"

# length → max_tokens
_LENGTH_TOKENS = {"short": 400, "medium": 900, "long": 1800}

_VIDEO_METRIC_KEYS = [
    "imp",
    "view_count",
    "subscriber_gain",
    "unique_viewers",
    "live_views",
    "archive_views",
    "avg_concurrent_viewers",
    "max_concurrent_viewers",
    "avg_view_duration",
    "avg_view_percentage",
    "repeater_ratio",
]

_PROGRAM_FILTER = (Video.content_type == "regular", Video.is_competitor == False)  # noqa: E712


class AnalysisUnavailable(Exception):
    """ANTHROPIC_API_KEY 未設定など、AI 実行不可。"""


class EntityNotFound(Exception):
    """対象 entity が存在しない。"""


def _video_metrics(db: Session, video_id: UUID) -> dict[str, float]:
    rows = db.scalars(
        select(LatestMetricValue).where(
            LatestMetricValue.entity_type == "videos",
            LatestMetricValue.entity_id == video_id,
        )
    ).all()
    found = {r.metric_key: float(r.value) for r in rows}
    return {k: found.get(k) for k in _VIDEO_METRIC_KEYS}


def build_input_data(db: Session, entity_type: str, entity_id: UUID) -> dict:
    """対象 entity の集計データ（プロンプト用）を組み立てる。"""
    if entity_type == "videos":
        v = db.get(Video, entity_id)
        if v is None:
            raise EntityNotFound("video not found")
        event_name = None
        if v.event_id:
            ev = db.get(Event, v.event_id)
            event_name = ev.name if ev else None
        return {
            "video": {
                "title": v.title,
                "program_type": v.program_type,
                "published_at": v.published_at.isoformat() if v.published_at else None,
                "event_name": event_name,
            },
            "metrics": _video_metrics(db, entity_id),
        }

    if entity_type == "events":
        ev = db.get(Event, entity_id)
        if ev is None:
            raise EntityNotFound("event not found")

        # period_kpis
        kpi_rows = db.execute(
            select(
                LatestMetricValue.metric_key.label("k"),
                func.sum(LatestMetricValue.value).label("s"),
                func.avg(LatestMetricValue.value).label("a"),
                func.max(LatestMetricValue.value).label("m"),
                func.count().label("c"),
            )
            .select_from(LatestMetricValue)
            .join(Video, Video.id == LatestMetricValue.entity_id)
            .where(
                LatestMetricValue.entity_type == "videos",
                Video.event_id == entity_id,
                *_PROGRAM_FILTER,
                LatestMetricValue.metric_key.in_(
                    ["imp", "view_count", "subscriber_gain", "avg_view_percentage", "max_concurrent_viewers"]
                ),
            )
            .group_by(LatestMetricValue.metric_key)
        ).all()
        by_key = {r.k: r for r in kpi_rows}

        def kpi(key: str, attr: str) -> dict:
            r = by_key.get(key)
            val = getattr(r, attr) if r is not None else None
            return {
                "value": float(val) if val is not None else None,
                "count": int(r.c) if r is not None else 0,
            }

        period_kpis = {
            "total_impressions": kpi("imp", "s"),
            "total_views": kpi("view_count", "s"),
            "total_subscriber_gain": kpi("subscriber_gain", "s"),
            "avg_view_percentage": kpi("avg_view_percentage", "a"),
            "max_concurrent_viewers": kpi("max_concurrent_viewers", "m"),
        }

        # programs_by_max_ccu（上位）
        vids = db.scalars(
            select(Video).where(Video.event_id == entity_id, *_PROGRAM_FILTER)
        ).all()
        ids = [v.id for v in vids]
        rank: dict[UUID, dict[str, float]] = {}
        if ids:
            for r in db.scalars(
                select(LatestMetricValue).where(
                    LatestMetricValue.entity_type == "videos",
                    LatestMetricValue.entity_id.in_(ids),
                    LatestMetricValue.metric_key.in_(
                        ["max_concurrent_viewers", "avg_concurrent_viewers", "view_count"]
                    ),
                )
            ).all():
                rank.setdefault(r.entity_id, {})[r.metric_key] = float(r.value)
        programs = [
            {
                "title": v.title,
                "program_type": v.program_type,
                "max_concurrent_viewers": rank.get(v.id, {}).get("max_concurrent_viewers"),
                "avg_concurrent_viewers": rank.get(v.id, {}).get("avg_concurrent_viewers"),
                "view_count": rank.get(v.id, {}).get("view_count"),
            }
            for v in vids
        ]
        programs.sort(
            key=lambda p: (p["max_concurrent_viewers"] is None, -(p["max_concurrent_viewers"] or 0))
        )

        return {
            "event": {
                "name": ev.name,
                "venue": ev.venue,
                "grade": ev.grade,
                "start_date": ev.start_date.isoformat() if ev.start_date else None,
                "end_date": ev.end_date.isoformat() if ev.end_date else None,
            },
            "period_kpis": period_kpis,
            "programs_by_max_ccu": programs,
        }

    raise EntityNotFound(f"unsupported entity_type: {entity_type}")


def _compose_prompt(base_prompt: str, tone: str, length: str, input_data: dict) -> str:
    body = base_prompt.replace("{tone}", tone).replace("{length}", length)
    data_json = json.dumps(input_data, ensure_ascii=False, indent=2, default=str)
    return (
        f"{body}\n\n"
        f"# 分析対象データ(JSON)\n{data_json}\n\n"
        f"# 指示\n日本語で、事実ベースに、トーン「{tone}」・分量「{length}」で記述してください。"
    )


def _call_claude(prompt: str, length: str) -> str:
    from anthropic import Anthropic

    client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    max_tokens = _LENGTH_TOKENS.get(length, _LENGTH_TOKENS[DEFAULT_LENGTH])
    msg = client.messages.create(
        model=settings.ANALYSIS_MODEL,
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    )
    return "".join(block.text for block in msg.content if getattr(block, "type", None) == "text")


def run_analysis(
    db: Session,
    *,
    entity_type: str,
    entity_id: UUID,
    template_id: UUID | None = None,
    adhoc_prompt: str | None = None,
    tone: str | None = None,
    length: str | None = None,
) -> AnalysisResult:
    if not settings.ANTHROPIC_API_KEY:
        raise AnalysisUnavailable("ANTHROPIC_API_KEY is not configured")

    template: AnalysisTemplate | None = None
    if template_id is not None:
        template = db.get(AnalysisTemplate, template_id)
        if template is None:
            raise EntityNotFound("template not found")
        base_prompt = template.prompt
        tone = tone or template.tone or DEFAULT_TONE
        length = length or template.length or DEFAULT_LENGTH
    else:
        if not adhoc_prompt:
            raise EntityNotFound("prompt is required when template_id is not given")
        base_prompt = adhoc_prompt
        tone = tone or DEFAULT_TONE
        length = length or DEFAULT_LENGTH

    input_data = build_input_data(db, entity_type, entity_id)
    prompt = _compose_prompt(base_prompt, tone, length, input_data)
    generated_text = _call_claude(prompt, length)

    result = AnalysisResult(
        template_id=template_id,
        entity_type=entity_type,
        entity_id=entity_id,
        generated_text=generated_text,
        input_data_snapshot=input_data,
        generated_at=datetime.now(timezone.utc),
    )
    db.add(result)
    db.commit()
    db.refresh(result)
    return result
