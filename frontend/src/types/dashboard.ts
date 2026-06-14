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

// GET /api/dashboard/webcm-monthly（WebCM=広告 の月別・指標別合計）
export interface WebcmMonthlyPoint {
  year_month: string; // 'YYYY-MM'
  webcm_view_count: number; // is_ad=true の view_count 合計
  ad_video_count: number; // is_ad=true の本数
  ad_total_watch_time_hours: number; // 総再生時間(h) 合計
  ad_new_viewers: number; // 新規視聴者 合計（参考: 差し引きは非推奨）
  ad_unique_viewers: number; // ユニーク視聴者 合計（参考: 差し引きは非推奨）
  ad_impressions: number; // インプレッション 合計
}

export interface WebcmMonthlyResponse {
  items: WebcmMonthlyPoint[]; // year_month 昇順
}

// GET /api/dashboard/channel-stats
// 総登録者数・総再生数の最新スナップショット（YouTube API 由来）。
// 値が取れない場合は各フィールド null（フロントは CSV 合算値にフォールバック）。
export interface ChannelStatsResponse {
  channel_id: string | null;
  snapshot_date: string | null; // 'YYYY-MM-DD'（JST 取得日）
  subscriber_count: number | null; // 総登録者数（現在の累計）
  view_count: number | null; // 総再生数（生涯累計）
  fetched_at: string | null; // ISO 8601（UTC）
}
