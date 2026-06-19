"""番組比較 API（レポートP4「番組ごと詳細数値」の再現）。

母集団は「自社・regular・program_type あり」の 142 番組（videos の歴史データ）。
これらは videos + metric_values に番組単位の詳細指標が揃っている。
競合・ショート・program_type 無しは対象外。

- GET /program-comparison/candidates : 比較対象に選べる番組一覧（種別/レース/月で絞り込み可）
- GET /program-comparison/detail      : 指定番組の詳細指標（metric_values から）

いずれも認証不要の読み取り専用。スキーマ変更は伴わない（既存テーブルを読むだけ）。
"""

from __future__ import annotations

from collections import defaultdict
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Date, cast, func, or_, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models import Event, LatestMetricValue, Video
from app.schemas.program_comparison import (
    ProgramCandidate,
    ProgramCandidatesResponse,
    ProgramDetail,
    ProgramDetailMetrics,
    ProgramDetailResponse,
)

router = APIRouter(prefix="/program-comparison", tags=["program-comparison"])

# 母集団: 自社・regular・program_type あり（= レポートP4の 142 番組）
_POPULATION_FILTER = (
    Video.content_type == "regular",
    Video.is_competitor == False,  # noqa: E712
    Video.program_type.is_not(None),
)

# published_at(UTC) → JST の 'YYYY-MM'
_JST_MONTH = func.to_char(func.timezone("Asia/Tokyo", Video.published_at), "YYYY-MM")

# detail で集める指標（archive_ratio は view_count/archive_views から計算で追加）
_DETAIL_METRIC_KEYS = [
    "view_count",
    "imp",
    "subscriber_gain",
    "max_concurrent_viewers",
    "avg_concurrent_viewers",
    "live_views",
    "archive_views",
    "avg_view_duration",
    "avg_view_percentage",
    "unique_viewers",
    "repeater_ratio",
]

_DETAIL_MAX = 10


def _event_name_map(db: Session, videos: list[Video]) -> dict[UUID, str]:
    """videos の event_id → event 名 を引く（紐付けがある分のみ）。"""
    event_ids = {v.event_id for v in videos if v.event_id is not None}
    if not event_ids:
        return {}
    return {
        e.id: e.name
        for e in db.scalars(select(Event).where(Event.id.in_(event_ids))).all()
    }


@router.get("/candidates", response_model=ProgramCandidatesResponse)
def candidates(
    race: str | None = Query(None, description="レース名（title / event名 の部分一致）"),
    program_type: str | None = Query(None, description="種別（program_type 完全一致）"),
    year_month: str | None = Query(None, description="公開月 'YYYY-MM'（JST）"),
    db: Session = Depends(get_db),
) -> ProgramCandidatesResponse:
    """比較対象に選べる番組一覧（母集団 142 本を種別/レース/月で絞り込み）。

    program_types / year_months は母集団全体から算出した安定した選択肢を返す
    （絞り込み中でもプルダウンの候補は縮まない）。
    """
    # --- フィルタ選択肢（母集団全体・絞り込みに依存しない） ---
    program_types = [
        r[0]
        for r in db.execute(
            select(Video.program_type)
            .where(*_POPULATION_FILTER)
            .group_by(Video.program_type)
            .order_by(func.count().desc())
        ).all()
    ]
    year_months = [
        r[0]
        for r in db.execute(
            select(_JST_MONTH.label("ym"))
            .where(*_POPULATION_FILTER, Video.published_at.is_not(None))
            .group_by("ym")
            .order_by("ym")
        ).all()
    ]

    # --- 絞り込み条件 ---
    conds = list(_POPULATION_FILTER)
    if program_type:
        conds.append(Video.program_type == program_type)
    if year_month:
        conds.append(_JST_MONTH == year_month)

    # レース名は title もしくは紐付く event 名の部分一致。event は外部結合。
    stmt = (
        select(Video, Event.name.label("event_name"))
        .outerjoin(Event, Event.id == Video.event_id)
        .where(*conds)
    )
    if race:
        like = f"%{race}%"
        stmt = stmt.where(or_(Video.title.ilike(like), Event.name.ilike(like)))

    stmt = stmt.order_by(Video.published_at.desc().nullslast(), Video.created_at.desc())

    rows = db.execute(stmt).all()
    items = [
        ProgramCandidate(
            video_id=v.id,
            youtube_video_id=v.youtube_video_id,
            title=v.title,
            program_type=v.program_type,
            published_at=v.published_at,
            event_name=ev_name,
            cast_members=list(v.cast_members or []),
        )
        for (v, ev_name) in rows
    ]
    return ProgramCandidatesResponse(
        items=items,
        total=len(items),
        program_types=program_types,
        year_months=year_months,
    )


@router.get("/detail", response_model=ProgramDetailResponse)
def detail(
    video_ids: str = Query(..., description="動画UUIDのカンマ区切り（最大10件）"),
    db: Session = Depends(get_db),
) -> ProgramDetailResponse:
    """指定番組の詳細指標を返す（要求順を保持）。

    母集団(142本)外・不正UUID・存在しないIDは not_found に積む。
    欠損している指標は null。archive_ratio = archive_views / view_count。
    """
    raw = [s.strip() for s in video_ids.split(",") if s.strip()]
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="video_ids is required"
        )
    if len(raw) > _DETAIL_MAX:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"too many video_ids (max {_DETAIL_MAX})",
        )

    # 重複除去しつつ要求順を保持
    ordered: list[str] = []
    seen: set[str] = set()
    for s in raw:
        if s not in seen:
            seen.add(s)
            ordered.append(s)

    not_found: list[str] = []
    uuid_list: list[UUID] = []
    for s in ordered:
        try:
            uuid_list.append(UUID(s))
        except ValueError:
            not_found.append(s)  # UUID として不正

    # 母集団内に限定して取得（母集団外は found に含まれず not_found へ）
    found: dict[UUID, Video] = {}
    if uuid_list:
        found = {
            v.id: v
            for v in db.scalars(
                select(Video).where(Video.id.in_(uuid_list), *_POPULATION_FILTER)
            ).all()
        }

    # 指標を一括取得
    metrics_map: dict[UUID, dict[str, float]] = defaultdict(dict)
    if found:
        for r in db.scalars(
            select(LatestMetricValue).where(
                LatestMetricValue.entity_type == "videos",
                LatestMetricValue.entity_id.in_(list(found.keys())),
                LatestMetricValue.metric_key.in_(_DETAIL_METRIC_KEYS),
            )
        ).all():
            metrics_map[r.entity_id][r.metric_key] = float(r.value)

    event_names = _event_name_map(db, list(found.values()))

    # 要求順（ordered の順）で組み立て。母集団外は not_found。
    items: list[ProgramDetail] = []
    for s in ordered:
        try:
            u = UUID(s)
        except ValueError:
            continue  # 既に not_found 済み
        v = found.get(u)
        if v is None:
            not_found.append(s)
            continue
        m = metrics_map.get(u, {})
        view_count = m.get("view_count")
        archive_views = m.get("archive_views")
        archive_ratio = (
            archive_views / view_count
            if view_count not in (None, 0) and archive_views is not None
            else None
        )
        items.append(
            ProgramDetail(
                video_id=v.id,
                youtube_video_id=v.youtube_video_id,
                title=v.title,
                program_type=v.program_type,
                published_at=v.published_at,
                event_name=event_names.get(v.event_id) if v.event_id else None,
                cast_members=list(v.cast_members or []),
                metrics=ProgramDetailMetrics(
                    view_count=view_count,
                    imp=m.get("imp"),
                    subscriber_gain=m.get("subscriber_gain"),
                    max_concurrent_viewers=m.get("max_concurrent_viewers"),
                    avg_concurrent_viewers=m.get("avg_concurrent_viewers"),
                    live_views=m.get("live_views"),
                    archive_views=archive_views,
                    archive_ratio=archive_ratio,
                    avg_view_duration=m.get("avg_view_duration"),
                    avg_view_percentage=m.get("avg_view_percentage"),
                    unique_viewers=m.get("unique_viewers"),
                    repeater_ratio=m.get("repeater_ratio"),
                ),
            )
        )

    return ProgramDetailResponse(items=items, not_found=not_found)
