// GET /api/traffic-sources のレスポンス型（backend schemas/traffic.py と対応）。P12。

export interface TrafficSourceItem {
  source_key: string; // カテゴリ名
  source_name: string | null;
  view_count: number | null;
  view_share: number | null; // 視聴回数の構成比（0〜1）
  avg_watch_seconds: number | null;
  total_watch_hours: number | null;
  imp: number | null;
  ctr: number | null; // 0〜1
}

export interface RelatedVideoItem {
  source_key: string; // 関連動画ID
  title: string | null;
  view_count: number | null;
  avg_watch_seconds: number | null;
  total_watch_hours: number | null;
}

export interface ExternalSiteItem {
  source_key: string; // 外部URL/識別子
  name: string | null; // 表示名（無ければ source_key を使う）
  view_count: number | null;
  avg_watch_seconds: number | null;
  total_watch_hours: number | null;
}

export interface TrafficSourcesResponse {
  year_month: string | null; // 対象月（データ無しなら null）
  available_months: string[]; // 選択可能な月（昇順）
  total_view_count: number; // 構成比の母数（カテゴリ視聴回数合計）
  sources: TrafficSourceItem[]; // 視聴回数の降順
  related_videos: RelatedVideoItem[]; // 視聴回数の降順 上位10件
  external_sites: ExternalSiteItem[]; // 「外部」内訳 視聴回数の降順 上位10件
}
