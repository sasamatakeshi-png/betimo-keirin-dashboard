// 同接レース選択（/concurrent-analysis）の型。backend schemas/concurrent.py と対応。

export interface RaceVideo {
  video_id: string;
  youtube_video_id: string | null;
  channel_name: string;
  is_competitor: boolean;
}

export interface RaceGroup {
  race_key: string;
  date: string;
  label: string;
  betimo_present: boolean;
  competitor_count: number;
  videos: RaceVideo[];
}
