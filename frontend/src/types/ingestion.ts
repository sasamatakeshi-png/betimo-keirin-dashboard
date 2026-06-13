// 取り込み系の型（バックエンド schemas/ingestion.py と対応）

export type IngestType = "zenkikan_csv" | "90d_csv";

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

export interface UploadResult {
  inserted: number;
  skipped: number;
  matched_videos: number;
  unmatched: number;
  created?: number; // ショート取り込みで新規作成した動画本数
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
