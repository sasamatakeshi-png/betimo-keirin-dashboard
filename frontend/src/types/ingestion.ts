// 取り込み系の型（バックエンド schemas/ingestion.py と対応）

export type IngestType =
  | "zenkikan_csv"
  | "90d_csv"
  | "live_views_csv"
  | "archive_views_csv";

// ショート専用CSVの種別（全期間 / 90日。列構成は通常と別物）
export type ShortIngestType = "short_zenkikan_csv" | "short_90d_csv";

// 月次CSV（チャンネル全体データ）の入力種別
export type MonthlySegment = "all" | "live" | "short";
export type MonthlyKind = "metrics" | "demographics";

// POST /api/ingestion/monthly のレスポンス（schemas/ingestion.py MonthlyUploadResult と対応）
export interface MonthlyUploadResult {
  year_month: string; // 'YYYY-MM'
  segment: MonthlySegment;
  kind: MonthlyKind;
  rows_written: number;
  replaced: boolean;
  log_id: string;
}

// POST /api/ingestion/monthly-video のレスポンス（schemas/ingestion.py MonthlyVideoUploadResult と対応）
export interface MonthlyVideoUploadResult {
  year_month: string; // 'YYYY-MM'
  rows_written: number; // 保存した動画行数
  ad_rows: number; // うち WebCM(is_ad=true) 本数
  skipped: number; // ID空/合計行などスキップ数
  replaced: boolean;
  log_id: string;
}

// POST /api/ingestion/concurrent のレスポンス（schemas/ingestion.py ConcurrentUploadResult と対応）
export interface ConcurrentUploadResult {
  inserted_points: number; // metric_timeseries 新規投入点数
  duplicate_points: number; // 既存と重複した点数
  videos_total: number; // 対象3社+Betimo として処理した動画本数
  videos_created: number; // うち新規作成した競合動画本数
  scalars_written: number; // 保存した最大/平均同接の行数
  skipped_rows: number; // 対象外チャンネル等でスキップした行数
  start_time: string | null; // 設定シートの計測開始日時（JST）
  used_youtube_api: boolean; // published_at 解決で YouTube API を呼んだか
  log_id: string;
}

// Studio自社同接CSV（schemas/ingestion.py StudioCcu* と対応）
export interface StudioCcuCandidate {
  video_id: string;
  title: string;
  youtube_video_id: string | null;
  published_at: string | null;
  score: number;
  date_match: boolean;
}

// POST /api/ingestion/studio-ccu/preview のレスポンス（保存しない）
export interface StudioCcuPreviewResult {
  filename: string | null;
  row_count: number;
  blank_or_invalid: number;
  duration_seconds: number;
  max_concurrent: number;
  avg_concurrent: number;
  parsed_month: number | null;
  parsed_day: number | null;
  race_name: string | null;
  suggested_video_id: string | null;
  candidates: StudioCcuCandidate[];
}

// POST /api/ingestion/studio-ccu/commit のレスポンス（max/avgをStudio値で上書き）
export interface StudioCcuCommitResult {
  video_id: string;
  title: string;
  youtube_video_id: string | null;
  max_concurrent: number;
  avg_concurrent: number;
  row_count: number;
  replaced: boolean;
  log_id: string;
}

export interface UploadResult {
  inserted: number;
  skipped: number;
  matched_videos: number;
  unmatched: number;
  created?: number; // ショート取り込みで新規作成した動画本数
  log_id: string;
}

// 削除可能な月次種別（バックエンド monthly_deletion.DELETABLE_KINDS と対応）
export type DeletableKind =
  | "monthly_metrics"
  | "monthly_demographics"
  | "monthly_video";

// GET /api/ingestion/delete-preview のレスポンス（件数のみ・削除しない）
export interface DeletePreviewResult {
  kind: DeletableKind;
  table: string;
  year_month: string;
  segment: MonthlySegment | null; // monthly_video は null
  count: number;
}

// DELETE /api/ingestion/monthly のレスポンス
export interface DeleteResult {
  kind: DeletableKind;
  table: string;
  year_month: string;
  segment: MonthlySegment | null;
  deleted: number;
  log_id: string;
}

export interface IngestionLog {
  id: string;
  source_type: string;
  file_name: string | null;
  records_processed: number;
  records_failed: number;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  error_log: Record<string, unknown> | null;
}
