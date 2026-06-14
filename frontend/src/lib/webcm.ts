// WebCM（広告）除外ロジック。ホームの「WebCM除く/込む」トグルで共有する。
//
// 方針:
//  - 「WebCM除く」= monthly_channel_metrics(all) の各指標 − その月の is_ad=true 合計。
//  - 差し引き対象は「加算的に正しい」指標のみ: 再生数 / 総再生時間。
//    （unique_viewers / new_viewers はチャンネル側が重複排除済みで
//     「全体 − WebCM」が負になり得るため対象外。impressions は WebCM 影響が
//     僅少なため従来どおり据え置く。）
//  - WebCM は番組系の長尺動画であり live/short には含まれないため、
//    差し引きは segment='all' のときのみ適用する。
//  - WebCM データが無い月（ad=0）は差し引き 0 で「除く=込む」になる（正常）。
//  - WebCM 取得失敗（webcm=null）時は差し引かず「込む（従来値）」にフォールバック。

import type { MonthlyMetricPoint, WebcmMonthlyResponse } from "@/types/dashboard";

export type WebcmMode = "exclude" | "include";

// トグルで実際に切り替わる（差し引き対象の）指標キー。
export const WEBCM_ADJUSTED_KEYS = [
  "view_count",
  "total_watch_time_hours",
] as const;
export type WebcmAdjustedKey = (typeof WEBCM_ADJUSTED_KEYS)[number];

export function isWebcmAdjustedKey(key: string): key is WebcmAdjustedKey {
  return (WEBCM_ADJUSTED_KEYS as readonly string[]).includes(key);
}

// year_month → { view_count, total_watch_time_hours } の WebCM 合計マップ。
function webcmMap(
  webcm: WebcmMonthlyResponse | null,
): Map<string, { view_count: number; total_watch_time_hours: number }> {
  const m = new Map<string, { view_count: number; total_watch_time_hours: number }>();
  if (!webcm) return m;
  for (const p of webcm.items) {
    m.set(p.year_month, {
      view_count: p.webcm_view_count ?? 0,
      total_watch_time_hours: p.ad_total_watch_time_hours ?? 0,
    });
  }
  return m;
}

// 月次配列に対し、mode='exclude' のとき各月から WebCM 分を差し引いた新配列を返す。
// 差し引くのは view_count / total_watch_time_hours のみ。負値は 0 でガード。
// segmentApplicable=false（live/short）または mode='include' のときは原データをそのまま返す。
export function adjustMetricsForWebcm(
  metrics: MonthlyMetricPoint[],
  webcm: WebcmMonthlyResponse | null,
  mode: WebcmMode,
  segmentApplicable: boolean,
): MonthlyMetricPoint[] {
  if (mode === "include" || !segmentApplicable || !webcm) return metrics;
  const map = webcmMap(webcm);
  return metrics.map((it) => {
    const ad = map.get(it.year_month);
    if (!ad) return it;
    const adjust = (v: number | null, sub: number): number | null =>
      v == null ? v : Math.max(0, v - sub);
    return {
      ...it,
      view_count: adjust(it.view_count, ad.view_count),
      total_watch_time_hours: adjust(it.total_watch_time_hours, ad.total_watch_time_hours),
    };
  });
}
