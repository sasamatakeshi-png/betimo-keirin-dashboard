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


class ConcurrentUploadResult(BaseModel):
    """同接xlsx（1ファイル=1レース1日）取り込み結果。"""

    inserted_points: int  # metric_timeseries に新規投入した点数
    duplicate_points: int  # 既存と重複でスキップした点数
    videos_total: int  # 対象3社+Betimo として処理した動画本数
    videos_created: int  # うち新規作成した競合動画本数
    scalars_written: int  # 保存した最大/平均同接の行数（動画数×2）
    skipped_rows: int  # 対象外チャンネル等でスキップした行数
    failed_videos: int = 0  # 不備によりスキップした動画本数（詳細は ingestion_logs）
    start_time: datetime | None  # 設定シートの計測開始日時（JST）
    used_youtube_api: bool  # published_at 解決で YouTube API を呼んだか
    log_id: UUID


class DeletePreviewResult(BaseModel):
    """削除プレビュー（件数のみ。実際には削除しない）。"""

    kind: str  # monthly_metrics | monthly_demographics | monthly_video
    table: str
    year_month: str
    segment: str | None  # monthly_video は None
    count: int


class DeleteResult(BaseModel):
    """削除実行結果（監査ログ付き）。"""

    kind: str
    table: str
    year_month: str
    segment: str | None
    deleted: int
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
