// 動画・一覧系の型（バックエンド schemas/video.py, event.py, metric.py と対応）

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface Video {
  id: string;
  youtube_video_id: string | null;
  channel_id: string;
  event_id: string | null;
  title: string;
  published_at: string | null;
  duration_seconds: number | null;
  venue: string | null;
  grade: string | null;
  title_tag: string | null;
  program_type: string | null;
  cast_members: string[];
  thumbnail_url: string | null;
  is_competitor: boolean;
  content_type: string;
  created_at: string;
  updated_at: string;
  metrics: Record<string, number> | null;
}

export interface EventLite {
  id: string;
  name: string;
  venue: string | null;
  grade: string | null;
  start_date: string | null;
  end_date: string | null;
}

export interface VideoUpdate {
  program_type?: string | null;
  event_id?: string | null;
  cast_members?: string[] | null;
  venue?: string | null;
  grade?: string | null;
  title_tag?: string | null;
}
