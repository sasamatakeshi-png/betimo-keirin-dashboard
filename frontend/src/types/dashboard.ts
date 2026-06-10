// GET /api/dashboard/home のレスポンス型（バックエンド schemas/dashboard.py と対応）

export interface Kpi {
  value: number | null;
  count: number;
  prev_value: number | null;
  change_ratio: number | null;
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

export interface EventMarker {
  date: string; // 'YYYY-MM-DD'（JST, イベント開始日）
  name: string;
  grade: string | null;
}

export interface HomeResponse {
  date_from: string | null;
  date_to: string | null;
  kpis: HomeKpis;
  views_trend: ViewsTrendPoint[];
  recent_events: RecentEvent[];
  ingestion_status: IngestionStatus[];
  events_markers: EventMarker[];
}

// ----- 月次（ホーム刷新用。backend schemas/dashboard.py と対応） -----

export type MonthlySegment = "all" | "live" | "short";

// GET /api/dashboard/monthly-metrics
export interface MonthlyMetricPoint {
  year_month: string; // 'YYYY-MM'
  segment: string;
  avg_view_duration_seconds: number | null;
  avg_view_percentage: number | null; // 生の % 値
  unique_viewers: number | null;
  new_viewers: number | null;
  repeat_viewers: number | null;
  view_count: number | null;
  total_watch_time_hours: number | null;
  subscribers: number | null;
  impressions: number | null;
  impressions_ctr: number | null; // 生の % 値
}

export interface MonthlyMetricsResponse {
  segment: string;
  items: MonthlyMetricPoint[]; // year_month 昇順
}

// GET /api/dashboard/monthly-demographics
export interface DemographicItem {
  age_band: string;
  gender: string; // male | female | other
  views_pct: number | null;
  watch_time_pct: number | null;
}

export interface MonthlyDemographicsResponse {
  year_month: string | null; // 対象月（データ無しなら null）
  segment: string;
  items: DemographicItem[];
}

// GET /api/dashboard/monthly-video-counts
export interface MonthlyVideoCountPoint {
  year_month: string; // 'YYYY-MM'
  counts: Record<string, number>; // 全種別キーを常に含む（0件でも0）
  total: number;
}

export interface MonthlyVideoCountsResponse {
  items: MonthlyVideoCountPoint[]; // year_month 昇順
}
