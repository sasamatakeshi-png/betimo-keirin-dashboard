"""流入経路系CSV取り込みサービス。

3種CSV(流入経路/外部流入/関連動画)を channel_traffic_sources へ upsert する。
grain=(year_month, source_type, source_key)。再投入=置換(ON CONFLICT DO UPDATE)。
チャンネル全体集計のため動画紐付けは行わない。ingestion_logs に1行記録。
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import ChannelTrafficSource, IngestionLog
from app.services.parsers import (
    parse_external_url_csv,
    parse_related_video_csv,
    parse_search_term_csv,
    parse_traffic_source_csv,
)

# source_type → パーサ。API の各エンドポイントから渡される。
_PARSERS = {
    "category": parse_traffic_source_csv,
    "external_url": parse_external_url_csv,
    "related_video": parse_related_video_csv,
    "search_term": parse_search_term_csv,
}

_UPSERT_SET_COLS = (
    "source_name",
    "imp",
    "ctr",
    "view_count",
    "avg_watch_seconds",
    "total_watch_hours",
)


def ingest_traffic_source(
    db: Session,
    content: bytes,
    filename: str | None,
    year_month: str,
    source_type: str,
) -> dict:
    """流入経路系CSVを channel_traffic_sources へ upsert する。

    source_type は 'category' / 'external_url' / 'related_video'。
    同一 (year_month, source_type, source_key) は最新値で置換する（冪等）。
    """
    started_at = datetime.now(timezone.utc)

    parser = _PARSERS.get(source_type)
    if parser is None:
        raise ValueError(f"unknown source_type: {source_type}")

    records = parser(content, source_type)

    # ファイル内で source_key 重複があると 1 INSERT 内で二重更新エラーになるため、
    # (source_key) で後勝ち集約してから投入する。
    by_key: dict[str, dict] = {}
    skipped = 0
    for rec in records:
        key = rec["source_key"]
        if not key:
            skipped += 1
            continue
        by_key[key] = rec
    values = [{"year_month": year_month, **rec} for rec in by_key.values()]

    written = 0
    if values:
        stmt = pg_insert(ChannelTrafficSource).values(values)
        stmt = stmt.on_conflict_do_update(
            index_elements=["year_month", "source_type", "source_key"],
            set_={
                **{c: getattr(stmt.excluded, c) for c in _UPSERT_SET_COLS},
                "updated_at": func.now(),
            },
        )
        db.execute(stmt)
        written = len(values)

    completed_at = datetime.now(timezone.utc)
    log = IngestionLog(
        source_type="csv",  # 既存CHECK許容値。詳細は file_name で識別
        file_name=filename,
        records_processed=len(records),
        records_failed=0,
        status="success" if values else "success",
        started_at=started_at,
        completed_at=completed_at,
        error_log={"kind": "traffic_source", "source_type": source_type, "year_month": year_month},
    )
    db.add(log)
    db.commit()
    db.refresh(log)

    return {
        "year_month": year_month,
        "source_type": source_type,
        "rows_written": written,
        "skipped": skipped,
        "log_id": log.id,
    }
