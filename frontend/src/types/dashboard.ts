// GET /api/dashboard/home のレスポンス型（バックエンド schemas/dashboard.py と対応）

export interface Kpi {
  value: number | null;
  count: number;
}

export interface HomeKpis {
  total_impressions: Kpi;
  total_views: Kpi;
  total_subscriber_gain: Kpi;
  max_concurrent_viewers: Kpi;
}

export interface ViewsTrendPoint {
  date: string; // 'YYYY-MM-DD'（JST）
  views: number;
  video_count: number;
}

export interface RecentEvent {
  id: string;
  name: string;
  grade: string | null;
  start_date: string | null;
  end_date: string | null;
  video_count: number;
}

export interface IngestionStatus {
  status: string;
  source_type: string;
  file_name: string | null;
  completed_at: string | null;
}

export interface HomeResponse {
  date_from: string | null;
  date_to: string | null;
  kpis: HomeKpis;
  views_trend: ViewsTrendPoint[];
  recent_events: RecentEvent[];
  ingestion_status: IngestionStatus[];
}
