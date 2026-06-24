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


class TrafficSourceResult(BaseModel):
    """流入経路系CSV（流入経路/外部流入/関連動画）取り込み結果。"""

    year_month: str
    source_type: str  # category | external_url | related_video
    rows_written: int  # upsert した行数
    skipped: int  # source_key 空などでスキップした行数
    log_id: UUID


class XCsvResult(BaseModel):
    """X(旧Twitter)日別CSV取り込み結果。"""

    rows_written: int  # upsert した日数
    skipped: int  # 日付重複で集約された行数
    date_from: str | None  # 取り込んだ最古日 'YYYY-MM-DD'
    date_to: str | None  # 取り込んだ最新日 'YYYY-MM-DD'
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


class StudioCcuCandidate(BaseModel):
    """Studio自社同接CSVの動画候補（自社regular動画）。"""

    video_id: UUID
    title: str
    youtube_video_id: str | None
    published_at: datetime | None
    score: int  # 推測スコア（日付一致+2 / レース名一致+1）
    date_match: bool  # 公開日(JST)の月日がファイル名と一致


class StudioCcuPreviewResult(BaseModel):
    """Studio自社同接CSVのプレビュー（計算値＋動画候補。保存はしない）。"""

    filename: str | None
    row_count: int  # 有効データ行数
    blank_or_invalid: int  # 空行・非数でスキップした行数
    duration_seconds: int  # 位置秒の最大（配信長の目安）
    max_concurrent: int  # ライブ同時視聴者数の最大
    avg_concurrent: int  # 平均同時視聴者数の平均（四捨五入）
    parsed_month: int | None  # ファイル名から推測した月
    parsed_day: int | None  # ファイル名から推測した日
    race_name: str | None  # ファイル名から推測したレース名
    suggested_video_id: UUID | None  # 推奨動画（候補先頭・スコア>0のとき）
    candidates: list[StudioCcuCandidate]


class StudioCcuCommitResult(BaseModel):
    """Studio自社同接CSVの確定保存結果（max/avgをStudio値で上書き）。"""

    video_id: UUID
    title: str
    youtube_video_id: str | None
    max_concurrent: int
    avg_concurrent: int
    row_count: int
    replaced: bool  # 既存スカラーを置換したか（常に True）
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
