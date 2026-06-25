// GET /api/x-analytics/daily のレスポンス型（backend schemas/x_analytics.py と対応）。P14。

export interface XDailyPoint {
  date: string; // 'YYYY-MM-DD'
  posts_created: number | null;
  imp: number | null;
  likes: number | null;
  engagements: number | null;
  follows_gained: number | null;
  unfollows: number | null;
  net_follows: number | null;
  replies: number | null;
  reposts: number | null;
  profile_visits: number | null;
  bookmarks: number | null;
  shares: number | null;
  video_views: number | null;
  media_views: number | null;
}

export interface XAnalyticsDailyResponse {
  date_from: string | null;
  date_to: string | null;
  prev_date_from: string | null;
  prev_date_to: string | null;
  available_from: string | null;
  available_to: string | null;
  items: XDailyPoint[]; // date 昇順
  period_totals: Record<string, number>; // 指標→期間計
  prev_period_totals: Record<string, number>; // 指標→前期間計
  change_ratios: Record<string, number | null>; // 指標→前期間比（不能は null）
}
