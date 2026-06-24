"""X(旧Twitter)日別CSV取り込みサービス。

X日別CSVを x_daily_metrics へ upsert する。grain=(date)。再投入=置換。
net_follows は生成列のため INSERT/UPDATE に含めない。ingestion_logs に1行記録。
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import IngestionLog, XDailyMetric
from app.services.parsers import parse_x_csv

# upsert で更新する指標列（date は競合キー、net_follows は生成列なので除外）。
_METRIC_COLS = (
    "imp",
    "likes",
    "engagements",
    "bookmarks",
    "shares",
    "follows_gained",
    "unfollows",
    "replies",
    "reposts",
    "profile_visits",
    "posts_created",
    "video_views",
    "media_views",
)


def ingest_x_csv(db: Session, content: bytes, filename: str | None) -> dict:
    """X日別CSVを x_daily_metrics へ upsert する。同一 date は最新値で置換(冪等)。"""
    started_at = datetime.now(timezone.utc)

    records = parse_x_csv(content)

    # 同一ファイル内の date 重複は後勝ち集約（1 INSERT 内の二重更新エラーを回避）。
    by_date: dict = {}
    for rec in records:
        by_date[rec["date"]] = rec
    values = list(by_date.values())

    written = 0
    if values:
        stmt = pg_insert(XDailyMetric).values(values)
        stmt = stmt.on_conflict_do_update(
            index_elements=["date"],
            set_={
                **{c: getattr(stmt.excluded, c) for c in _METRIC_COLS},
                "updated_at": func.now(),
            },
        )
        db.execute(stmt)
        written = len(values)

    dates = [r["date"] for r in values]
    date_from = min(dates).isoformat() if dates else None
    date_to = max(dates).isoformat() if dates else None

    completed_at = datetime.now(timezone.utc)
    log = IngestionLog(
        source_type="csv",  # 既存CHECK許容値。詳細は file_name / error_log で識別
        file_name=filename,
        records_processed=len(records),
        records_failed=0,
        status="success",
        started_at=started_at,
        completed_at=completed_at,
        error_log={"kind": "x_daily", "date_from": date_from, "date_to": date_to},
    )
    db.add(log)
    db.commit()
    db.refresh(log)

    return {
        "rows_written": written,
        "skipped": len(records) - written,  # 日付重複で集約された分
        "date_from": date_from,
        "date_to": date_to,
        "log_id": log.id,
    }
