// 番組比較（レポートP4「番組ごと詳細数値」）の型。
// バックエンド schemas/program_comparison.py と対応。
// 母集団は自社・regular・program_type ありの 142 番組。

export interface ProgramCandidate {
  video_id: string;
  youtube_video_id: string | null;
  title: string;
  program_type: string | null;
  grade: string | null; // G1/G2/G3/F1/F2。未設定は null。
  published_at: string | null;
  event_name: string | null;
  cast_members: string[];
}

export interface ProgramCandidatesResponse {
  items: ProgramCandidate[];
  total: number;
  // 母集団全体から算出した安定したフィルタ選択肢（絞り込みで縮まない）。
  program_types: string[];
  year_months: string[];
}

// 比率(archive_ratio / avg_view_percentage / repeater_ratio)は 0〜1 の小数。
export interface ProgramDetailMetrics {
  view_count: number | null;
  imp: number | null;
  subscriber_gain: number | null;
  max_concurrent_viewers: number | null;
  avg_concurrent_viewers: number | null;
  live_views: number | null;
  archive_views: number | null;
  archive_ratio: number | null;
  avg_view_duration: number | null; // 秒
  avg_view_percentage: number | null; // 0〜1
  unique_viewers: number | null;
  repeater_ratio: number | null; // 0〜1
}

export interface ProgramDetail {
  video_id: string;
  youtube_video_id: string | null;
  title: string;
  program_type: string | null;
  grade: string | null; // G1/G2/G3/F1/F2。未設定は null。
  published_at: string | null;
  event_name: string | null;
  cast_members: string[];
  metrics: ProgramDetailMetrics;
}

export interface ProgramDetailResponse {
  items: ProgramDetail[];
  not_found: string[];
}
