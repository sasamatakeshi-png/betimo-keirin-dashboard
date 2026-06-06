// GET /api/events/{id}/summary の型（backend schemas/dashboard.py と対応）

import type { Kpi } from "@/types/dashboard";
import type { EventLite, Video } from "@/types/video";

export interface EventKpis {
  total_impressions: Kpi;
  total_views: Kpi;
  total_subscriber_gain: Kpi;
  avg_view_percentage: Kpi;
  max_concurrent_viewers: Kpi;
}

export interface ProgramRanking {
  video_id: string;
  title: string;
  program_type: string | null;
  published_at: string | null;
  max_concurrent_viewers: number | null;
  avg_concurrent_viewers: number | null;
  view_count: number | null;
}

export interface DailyPerformance {
  date: string;
  video_count: number;
  total_views: number | null;
  total_impressions: number | null;
  max_concurrent_viewers: number | null;
}

export interface EventSummary {
  event: EventLite;
  period_kpis: EventKpis;
  programs_by_max_ccu: ProgramRanking[];
  daily_performance: DailyPerformance[];
  videos: Video[];
}
