// 取り込み系の型（バックエンド schemas/ingestion.py と対応）

export type IngestType = "zenkikan_csv" | "90d_csv";

// ショート専用CSVの種別（全期間 / 90日。列構成は通常と別物）
export type ShortIngestType = "short_zenkikan_csv" | "short_90d_csv";

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
