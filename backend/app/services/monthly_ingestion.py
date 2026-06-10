"""月次CSV取り込みサービス（数値 / 性別年齢）。

既存 ingestion.py の挙動には一切手を入れず、月次専用ロジックを分離する。
- 数値: monthly_channel_metrics へ ON CONFLICT(channel_id, year_month, segment)
        DO UPDATE で「上書き更新」。
- デモグラ: (channel_id, year_month, segment) を DELETE → 一括 INSERT で「置換」。
- 自社チャンネルは is_own を動的解決（UUIDハードコードしない）。
- ingestion_logs に1行記録し、error_log に対象月/segment を残す（成功時も）。
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import (
    Channel,
    IngestionLog,
    MonthlyChannelMetric,
    MonthlyDemographic,
)
from app.services.parsers import (
    parse_monthly_demographics_csv,
    parse_monthly_metrics_csv,
)

SEGMENTS = {"all", "live", "short"}
MONTHLY_KINDS = {"metrics", "demographics"}

# monthly_channel_metrics の上書き対象列（id/channel_id/year_month/segment/created_at は除く）
_MCM_UPDATE_COLS = [
    "avg_view_duration_seconds",
    "avg_view_percentage",
    "unique_viewers",
    "new_viewers",
    "repeat_viewers",
    "view_count",
    "total_watch_time_hours",
    "subscribers",
    "impressions",
    "impressions_ctr",
    "source_file",
]


class MonthlyIngestError(ValueError):
    """月次取り込みの入力不正・前提不足（呼び出し側で 400 に変換する）。"""


def _resolve_own_channel_id(db: Session) -> UUID:
    cid = db.scalar(select(Channel.id).where(Channel.is_own.is_(True)))
    if cid is None:
        raise MonthlyIngestError(
            "自社チャンネル(is_own=true)が登録されていません。先にチャンネルを登録してください。"
        )
    return cid


def ingest_monthly_metrics_csv(
    db: Session, content: bytes, filename: str | None, year_month: str, segment: str
) -> dict:
    """数値CSVの合計行を monthly_channel_metrics へ上書き保存する。"""
    started_at = datetime.now(timezone.utc)
    channel_id = _resolve_own_channel_id(db)

    metrics = parse_monthly_metrics_csv(content)
    rows_written = 0
    if metrics:
        values = {
            "channel_id": channel_id,
            "year_month": year_month,
            "segment": segment,
            "source_file": filename,
            **metrics,
        }
        update_set = {
            col: values.get(col) for col in _MCM_UPDATE_COLS
        }
        stmt = (
            pg_insert(MonthlyChannelMetric)
            .values(**values)
            .on_conflict_do_update(
                index_elements=["channel_id", "year_month", "segment"],
                set_=update_set,
            )
            .returning(MonthlyChannelMetric.id)
        )
        rows_written = len(db.execute(stmt).fetchall())

    status = "success" if metrics else "failed"
    log = IngestionLog(
        source_type="monthly_metrics_csv",
        file_name=filename,
        records_processed=1 if metrics else 0,
        records_failed=0 if metrics else 1,
        status=status,
        started_at=started_at,
        completed_at=datetime.now(timezone.utc),
        error_log={
            "year_month": year_month,
            "segment": segment,
            "note": None if metrics else "合計行から指標を抽出できませんでした",
        },
    )
    db.add(log)
    db.commit()
    db.refresh(log)

    return {
        "year_month": year_month,
        "segment": segment,
        "kind": "metrics",
        "rows_written": rows_written,
        "replaced": True,
        "log_id": log.id,
    }


def ingest_monthly_demographics_csv(
    db: Session, content: bytes, filename: str | None, year_month: str, segment: str
) -> dict:
    """性別年齢CSVを (channel_id, year_month, segment) 単位で置換保存する。"""
    started_at = datetime.now(timezone.utc)
    channel_id = _resolve_own_channel_id(db)

    records = parse_monthly_demographics_csv(content)

    # 置換: 同一(月,segment)を全削除 → 一括INSERT（古い年齢層/性別が残らない）。
    db.execute(
        delete(MonthlyDemographic).where(
            MonthlyDemographic.channel_id == channel_id,
            MonthlyDemographic.year_month == year_month,
            MonthlyDemographic.segment == segment,
        )
    )

    rows_written = 0
    if records:
        rows = [
            {
                "channel_id": channel_id,
                "year_month": year_month,
                "segment": segment,
                "age_band": rec["age_band"],
                "gender": rec["gender"],
                "views_pct": rec["views_pct"],
                "watch_time_pct": rec["watch_time_pct"],
                "source_file": filename,
            }
            for rec in records
            if rec["age_band"]
        ]
        # 同一CSV内に (age_band,gender) 重複があっても一意制約に触れないよう後勝ちで集約
        dedup: dict[tuple[str, str], dict] = {}
        for r in rows:
            dedup[(r["age_band"], r["gender"])] = r
        rows = list(dedup.values())
        if rows:
            stmt = (
                pg_insert(MonthlyDemographic)
                .values(rows)
                .returning(MonthlyDemographic.id)
            )
            rows_written = len(db.execute(stmt).fetchall())

    status = "success" if records else "failed"
    log = IngestionLog(
        source_type="monthly_demographics_csv",
        file_name=filename,
        records_processed=len(records),
        records_failed=0 if records else 1,
        status=status,
        started_at=started_at,
        completed_at=datetime.now(timezone.utc),
        error_log={
            "year_month": year_month,
            "segment": segment,
            "note": None if records else "年齢/性別の行を抽出できませんでした",
        },
    )
    db.add(log)
    db.commit()
    db.refresh(log)

    return {
        "year_month": year_month,
        "segment": segment,
        "kind": "demographics",
        "rows_written": rows_written,
        "replaced": True,
        "log_id": log.id,
    }
