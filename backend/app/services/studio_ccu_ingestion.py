"""YouTube Studio 自社同接CSV取り込み（最大/平均同接スカラーの上書き）。

2段階フロー（誤マッチ防止のため必ず人の確認を挟む）:
  1. preview: CSVをパース→最大/平均を計算し、ファイル名から日付・レース名を推測して
     自社動画(is_competitor=false)の候補を返す。保存はしない。
  2. commit: 確定した video_id を受け取り、CSVを再パースして最大/平均を計算し、
     その動画の max/avg_concurrent_viewers を Studio値で「常に上書き」する。

保存方針:
  - Studio は最も正確なので大小比較せず常に上書き（同接xlsx由来の粗い値を置換）。
  - source は既存許容値 'manual'、source_file に 'studio_ccu:<filename>' を記録して由来を判別可能に。
  - 冪等: 該当 video × {max,avg}_concurrent_viewers × source='manual' を削除→再挿入。
  - 競合データ・時系列(metric_timeseries)には一切触れない（自社スカラーのみ）。
  - スキーマ変更なし。ingestion_logs.source_type は既存許容値 'csv' を流用。
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import IngestionLog, MetricValue, Video
from app.services.parsers.studio_ccu import parse_studio_ccu_csv

JST = timezone(timedelta(hours=9))

MAX_KEY = "max_concurrent_viewers"
AVG_KEY = "avg_concurrent_viewers"
SOURCE = "manual"  # metric_*_source_check の許容値
LOG_SOURCE_TYPE = "csv"  # ingestion_logs.source_type の既存許容値を流用
SOURCE_FILE_PREFIX = "studio_ccu:"  # source_file 先頭に付け Studio CSV 由来を判別可能に

# ファイル名から日付（M/D, M_D, M-D, M.D）を拾う
_DATE_RE = re.compile(r"(\d{1,2})[._/\-](\d{1,2})")
# 先頭の【…】ブロック（例「【競輪ライブ6_21】」）
_BRACKET_RE = re.compile(r"【[^】]*】")
# 最初のハッシュタグ語（# / ＃）
_HASHTAG_RE = re.compile(r"[#＃]\s*([^\s#＃【】]+)")


def studio_source_file(filename: str | None) -> str:
    return f"{SOURCE_FILE_PREFIX}{filename or ''}"


def parse_filename_hints(filename: str | None) -> dict:
    """ファイル名から (month, day, race_name) を推測。取れなければ None。"""
    name = filename or ""
    month = day = None
    # まず【…】内の日付を優先（「【競輪ライブ6_21】」）
    bracket = _BRACKET_RE.search(name)
    search_spaces = [bracket.group(0)] if bracket else []
    search_spaces.append(name)
    for space in search_spaces:
        m = _DATE_RE.search(space)
        if m:
            mm, dd = int(m.group(1)), int(m.group(2))
            if 1 <= mm <= 12 and 1 <= dd <= 31:
                month, day = mm, dd
                break
    # レース名: 【…】を除去して最初のハッシュタグ語
    body = _BRACKET_RE.sub("", name)
    rm = _HASHTAG_RE.search(body)
    race_name = rm.group(1).strip() if rm else None
    return {"month": month, "day": day, "race_name": race_name}


def _suggest_candidates(
    db: Session, *, month: int | None, day: int | None, race_name: str | None, limit: int = 20
) -> list[dict]:
    """自社(regular)動画を日付一致・レース名一致でスコアリングして候補を返す。"""
    rows = db.execute(
        select(Video.id, Video.title, Video.youtube_video_id, Video.published_at).where(
            Video.is_competitor.is_(False), Video.content_type == "regular"
        )
    ).all()

    scored: list[tuple[int, datetime, dict]] = []
    epoch = datetime.min.replace(tzinfo=timezone.utc)
    for vid, title, yid, pub in rows:
        score = 0
        date_match = False
        if month and day and pub is not None:
            pj = pub.astimezone(JST)
            if pj.month == month and pj.day == day:
                score += 2
                date_match = True
        if race_name and title and race_name in title:
            score += 1
        scored.append(
            (
                score,
                pub or epoch,
                {
                    "video_id": vid,
                    "title": title,
                    "youtube_video_id": yid,
                    "published_at": pub,
                    "score": score,
                    "date_match": date_match,
                },
            )
        )

    # スコア降順 → 公開日降順。score>0 を優先しつつ、足りなければ最近の動画で埋める。
    scored.sort(key=lambda t: (t[0], t[1]), reverse=True)
    return [c for _, _, c in scored[:limit]]


def preview_studio_ccu(db: Session, content: bytes, filename: str | None) -> dict:
    """CSVを計算し、ファイル名から動画候補を推測して返す（保存しない）。"""
    parsed = parse_studio_ccu_csv(content)
    hints = parse_filename_hints(filename)
    candidates = _suggest_candidates(
        db, month=hints["month"], day=hints["day"], race_name=hints["race_name"]
    )
    suggested = candidates[0]["video_id"] if candidates and candidates[0]["score"] > 0 else None
    return {
        "filename": filename,
        "row_count": parsed["row_count"],
        "blank_or_invalid": parsed["blank_or_invalid"],
        "duration_seconds": parsed["duration_seconds"],
        "max_concurrent": parsed["max_concurrent"],
        "avg_concurrent": parsed["avg_concurrent"],
        "parsed_month": hints["month"],
        "parsed_day": hints["day"],
        "race_name": hints["race_name"],
        "suggested_video_id": suggested,
        "candidates": candidates,
    }


def _overwrite_scalar(
    db: Session, *, video_id: UUID, metric_key: str, value: float, source_file: str, recorded_at: datetime
) -> None:
    """該当 video×指標×source='manual' を削除→Studio値で再挿入（常に上書き・冪等）。"""
    db.execute(
        delete(MetricValue).where(
            MetricValue.entity_type == "videos",
            MetricValue.entity_id == video_id,
            MetricValue.metric_key == metric_key,
            MetricValue.source == SOURCE,
        )
    )
    # Core insert で投入（id/created_at は DB 既定値に任せる。ORM add だと NULL になる点を回避）
    db.execute(
        pg_insert(MetricValue).values(
            entity_type="videos",
            entity_id=video_id,
            metric_key=metric_key,
            value=value,
            recorded_at=recorded_at,
            source=SOURCE,
            source_file=source_file,
        )
    )


def commit_studio_ccu(
    db: Session, content: bytes, filename: str | None, video_id: UUID
) -> dict:
    """確定した自社動画に Studio計算値（最大/平均同接）を常に上書き保存する。"""
    started_at = datetime.now(timezone.utc)

    video = db.get(Video, video_id)
    if video is None:
        raise ValueError("指定された動画が見つかりません")
    if video.is_competitor:
        # 自社スカラーの上書き専用。競合には適用しない（取り違え防止）。
        raise ValueError("競合動画には適用できません（自社動画を選択してください）")

    parsed = parse_studio_ccu_csv(content)  # サーバ側で再計算（クライアント値は信用しない）
    max_v = parsed["max_concurrent"]
    avg_v = parsed["avg_concurrent"]
    src_file = studio_source_file(filename)
    recorded_at = datetime.now(timezone.utc)

    _overwrite_scalar(
        db, video_id=video.id, metric_key=MAX_KEY, value=max_v, source_file=src_file, recorded_at=recorded_at
    )
    _overwrite_scalar(
        db, video_id=video.id, metric_key=AVG_KEY, value=avg_v, source_file=src_file, recorded_at=recorded_at
    )

    log = IngestionLog(
        source_type=LOG_SOURCE_TYPE,
        file_name=filename,
        records_processed=2,  # max + avg
        records_failed=0,
        status="success",
        started_at=started_at,
        completed_at=datetime.now(timezone.utc),
        error_log={
            "kind": "studio_ccu",
            "video_id": str(video.id),
            "youtube_video_id": video.youtube_video_id,
            "max_concurrent": max_v,
            "avg_concurrent": avg_v,
            "row_count": parsed["row_count"],
        },
    )
    db.add(log)
    db.commit()
    db.refresh(log)

    return {
        "video_id": video.id,
        "title": video.title,
        "youtube_video_id": video.youtube_video_id,
        "max_concurrent": max_v,
        "avg_concurrent": avg_v,
        "row_count": parsed["row_count"],
        "replaced": True,
        "log_id": log.id,
    }
