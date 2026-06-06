"""CSV 取り込みサービス。

- パース結果を既存 video に紐づけ（youtube_video_id 優先、無ければ title 部分一致）
- metric_values へ INSERT のみ（ON CONFLICT DO NOTHING で冪等）
- recorded_at はファイル内容から決定論的に算出（同一ファイル再取り込みで重複しない）
- 結果を ingestion_logs に1行記録
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import IngestionLog, MetricValue, Video
from app.services.parsers import parse_90d_csv, parse_zenkikan_csv

INGEST_TYPES = {"zenkikan_csv", "90d_csv"}

# recorded_at の決定論的算出基準。壁時計 now() ではなくファイル内容ハッシュから導出し、
# 「同一ファイル再取り込みで重複しない」を保証する（B-1 移行の固定 recorded_at と同趣旨）。
_RECORDED_BASE = datetime(2026, 1, 1, tzinfo=timezone.utc)
_RECORDED_SPAN_SECONDS = 5 * 365 * 24 * 3600  # 約5年幅

_CONFLICT_COLS = ["entity_type", "entity_id", "metric_key", "recorded_at", "source"]


def deterministic_recorded_at(content: bytes) -> datetime:
    digest = hashlib.sha256(content).digest()
    offset = int.from_bytes(digest[:6], "big") % _RECORDED_SPAN_SECONDS
    return _RECORDED_BASE + timedelta(seconds=offset)


def _match_video(db: Session, identifier: str, yid_map: dict[str, UUID]) -> UUID | None:
    # 1) youtube_video_id 完全一致
    vid = yid_map.get(identifier)
    if vid is not None:
        return vid
    # 2) タイトル部分一致（曖昧=複数 or 0 件 は None）
    matches = db.scalars(
        select(Video.id).where(Video.title.ilike(f"%{identifier}%")).limit(2)
    ).all()
    if len(matches) == 1:
        return matches[0]
    return None


def ingest_csv(db: Session, content: bytes, filename: str | None, ingest_type: str) -> dict:
    started_at = datetime.now(timezone.utc)
    recorded_at = deterministic_recorded_at(content)

    if ingest_type == "zenkikan_csv":
        records = parse_zenkikan_csv(content)
    else:  # 90d_csv
        records = parse_90d_csv(content)
        # repeater_ratio が無ければ repeat/unique で算出（unique>0 のみ）
        for rec in records:
            m = rec["metrics"]
            if "repeater_ratio" not in m:
                uniq = m.get("unique_viewers")
                rep = m.get("repeat_viewers")
                if uniq and rep is not None and uniq > 0:
                    m["repeater_ratio"] = rep / uniq

    # 既存 video の youtube_video_id → id マップ
    yid_map: dict[str, UUID] = {
        yid: vid
        for yid, vid in db.execute(
            select(Video.youtube_video_id, Video.id).where(
                Video.youtube_video_id.is_not(None)
            )
        ).all()
    }

    matched_video_ids: set[UUID] = set()
    unmatched: list[str] = []
    skipped = 0
    rows_to_insert: list[dict] = []

    for rec in records:
        identifier = rec["identifier"]
        vid = _match_video(db, identifier, yid_map)
        if vid is None:
            unmatched.append(identifier)
            skipped += 1
            continue
        metrics = {k: v for k, v in rec["metrics"].items() if v is not None}
        matched_video_ids.add(vid)
        if not metrics:
            skipped += 1  # 紐づいたが投入値が無い
            continue
        for key, value in metrics.items():
            rows_to_insert.append(
                {
                    "entity_type": "videos",
                    "entity_id": vid,
                    "metric_key": key,
                    "value": value,
                    "recorded_at": recorded_at,
                    "source": "csv",
                    "source_file": filename,
                }
            )

    inserted = 0
    if rows_to_insert:
        stmt = (
            pg_insert(MetricValue)
            .values(rows_to_insert)
            .on_conflict_do_nothing(index_elements=_CONFLICT_COLS)
            .returning(MetricValue.id)
        )
        inserted = len(db.execute(stmt).fetchall())

    processed = len(records)
    if matched_video_ids and not unmatched:
        log_status = "success"
    elif matched_video_ids and unmatched:
        log_status = "partial"
    elif processed == 0:
        log_status = "success"
    else:
        log_status = "failed"

    completed_at = datetime.now(timezone.utc)
    log = IngestionLog(
        source_type="csv",
        file_name=filename,
        records_processed=processed,
        records_failed=len(unmatched),
        status=log_status,
        started_at=started_at,
        completed_at=completed_at,
        error_log={"unmatched": unmatched[:50]} if unmatched else None,
    )
    db.add(log)
    db.commit()
    db.refresh(log)

    return {
        "inserted": inserted,
        "skipped": skipped,
        "matched_videos": len(matched_video_ids),
        "unmatched": len(unmatched),
        "log_id": log.id,
    }
