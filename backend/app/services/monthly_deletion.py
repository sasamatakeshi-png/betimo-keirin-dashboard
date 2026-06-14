"""月次データの削除サービス（取り込みミスの修正用）。

安全装置:
  - 削除対象は「月次系3テーブル」のみ。各テーブルは (channel_id, year_month[, segment])
    で取り込み単位が一意に決まるため、範囲を厳密に限定できる。
  - 通常CSV/ショートCSV（metric_values）は取り込み単位の特定が不確実なため対象外。
  - count_* は読み取り専用（プレビュー）、delete_* のみが実際に削除する。
  - delete_* は ingestion_logs に監査ログを1行残す。
  - 既存スキーマは変更しない（既存テーブルへの DELETE のみ）。
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models import (
    Channel,
    IngestionLog,
    MonthlyChannelMetric,
    MonthlyDemographic,
    MonthlyVideoMetric,
)

_YEAR_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")

SEGMENTS = {"all", "live", "short"}

# 削除可能な種別 → (ORM モデル, テーブル名, segment 必須か)
_KIND_MAP = {
    "monthly_metrics": (MonthlyChannelMetric, "monthly_channel_metrics", True),
    "monthly_demographics": (MonthlyDemographic, "monthly_demographics", True),
    "monthly_video": (MonthlyVideoMetric, "monthly_video_metrics", False),
}

DELETABLE_KINDS = set(_KIND_MAP)


class MonthlyDeleteError(ValueError):
    """削除入力の不正・前提不足（呼び出し側で 400 に変換する）。"""


def _resolve_own_channel_id(db: Session) -> UUID:
    cid = db.scalar(select(Channel.id).where(Channel.is_own.is_(True)))
    if cid is None:
        raise MonthlyDeleteError(
            "自社チャンネル(is_own=true)が登録されていません。"
        )
    return cid


def _validate(kind: str, year_month: str, segment: str | None) -> bool:
    """入力を検証し、segment を使うか（True）否か（False）を返す。"""
    if kind not in _KIND_MAP:
        raise MonthlyDeleteError(
            f"kind must be one of {sorted(DELETABLE_KINDS)}"
        )
    if not year_month or not _YEAR_MONTH_RE.match(year_month):
        raise MonthlyDeleteError("year_month must be 'YYYY-MM'")
    _model, _table, seg_required = _KIND_MAP[kind]
    if seg_required:
        if segment not in SEGMENTS:
            raise MonthlyDeleteError(
                f"segment must be one of {sorted(SEGMENTS)} for kind={kind}"
            )
        return True
    return False


def _conds(model, channel_id: UUID, year_month: str, use_segment: bool, segment: str | None):
    """削除/集計の WHERE 条件。常に channel_id と year_month で限定し、
    segment 使用時のみ segment も加える（他月・他segmentへ波及させない）。"""
    conds = [model.channel_id == channel_id, model.year_month == year_month]
    if use_segment:
        conds.append(model.segment == segment)
    return conds


def count_monthly_rows(
    db: Session, kind: str, year_month: str, segment: str | None
) -> dict:
    """削除対象の件数を返す（読み取り専用・実際には消さない）。"""
    use_segment = _validate(kind, year_month, segment)
    model, table, _ = _KIND_MAP[kind]
    channel_id = _resolve_own_channel_id(db)
    count = (
        db.scalar(
            select(func.count()).select_from(model).where(
                *_conds(model, channel_id, year_month, use_segment, segment)
            )
        )
        or 0
    )
    return {
        "kind": kind,
        "table": table,
        "year_month": year_month,
        "segment": segment if use_segment else None,
        "count": int(count),
    }


def delete_monthly_rows(
    db: Session, kind: str, year_month: str, segment: str | None
) -> dict:
    """指定範囲（月[+segment]）のみを削除し、監査ログを残す。"""
    use_segment = _validate(kind, year_month, segment)
    model, table, _ = _KIND_MAP[kind]
    channel_id = _resolve_own_channel_id(db)
    started_at = datetime.now(timezone.utc)

    result = db.execute(
        delete(model).where(
            *_conds(model, channel_id, year_month, use_segment, segment)
        )
    )
    deleted = int(result.rowcount or 0)

    log = IngestionLog(
        source_type=f"delete_{kind}",
        file_name=None,
        records_processed=deleted,
        records_failed=0,
        status="success",
        started_at=started_at,
        completed_at=datetime.now(timezone.utc),
        error_log={
            "action": "delete",
            "kind": kind,
            "table": table,
            "year_month": year_month,
            "segment": segment if use_segment else None,
            "deleted": deleted,
        },
    )
    db.add(log)
    db.commit()
    db.refresh(log)

    return {
        "kind": kind,
        "table": table,
        "year_month": year_month,
        "segment": segment if use_segment else None,
        "deleted": deleted,
        "log_id": log.id,
    }
