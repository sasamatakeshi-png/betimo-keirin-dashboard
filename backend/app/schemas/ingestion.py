"""取り込みスキーマ。"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class UploadResult(BaseModel):
    inserted: int
    skipped: int
    matched_videos: int
    unmatched: int
    # ショート取り込みで新規作成した video 本数（通常CSVでは常に 0）
    created: int = 0
    log_id: UUID


class MonthlyUploadResult(BaseModel):
    """月次CSV取り込み結果。"""

    year_month: str
    segment: str
    kind: str  # metrics | demographics
    rows_written: int
    replaced: bool
    log_id: UUID


class MonthlyVideoUploadResult(BaseModel):
    """動画別CSV（月 × 動画）取り込み結果。"""

    year_month: str
    rows_written: int  # 保存した動画行数
    ad_rows: int  # うち is_ad=true（WebCM）と判定した本数
    skipped: int  # コンテンツID空/合計行などスキップした行数
    replaced: bool
    log_id: UUID


class IngestionLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    source_type: str
    file_name: str | None
    records_processed: int
    records_failed: int
    status: str
    started_at: datetime | None
    completed_at: datetime | None
    error_log: dict[str, Any] | None
