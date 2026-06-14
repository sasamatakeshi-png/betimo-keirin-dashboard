"use client";

// 月次データ表。月(行) × 主要指標(列)。segment は親が制御し推移グラフと連動。

import { formatNumber } from "@/lib/format";
import type { MonthlyMetricPoint } from "@/types/dashboard";

function ymLabel(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  return m ? `${Number(m[1])}年${Number(m[2])}月` : ym;
}

// 生の % 値（例 4.12）をそのまま % 表記
function pct(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(1)}%`;
}

export function MonthlyTable({
  items,
  webcmAdjusted = false,
}: {
  items: MonthlyMetricPoint[];
  // 「WebCM除く」適用中か。再生数・総再生時間の列見出しに注記を出す。
  // items 自体は呼び出し側で既に WebCM 差し引き済みを渡す前提。
  webcmAdjusted?: boolean;
}) {
  if (items.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-muted-foreground">データがありません</div>
    );
  }
  const cmSuffix = webcmAdjusted ? (
    <span className="ml-0.5 text-[10px] font-normal text-amber-600">(CM除)</span>
  ) : null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="px-2 py-2 font-medium">月</th>
            <th className="px-2 py-2 text-right font-medium">再生数{cmSuffix}</th>
            <th className="px-2 py-2 text-right font-medium">インプレッション</th>
            <th className="px-2 py-2 text-right font-medium">UU</th>
            <th className="px-2 py-2 text-right font-medium">新規</th>
            <th className="px-2 py-2 text-right font-medium">リピーター</th>
            <th className="px-2 py-2 text-right font-medium">総再生時間(h){cmSuffix}</th>
            <th className="px-2 py-2 text-right font-medium">登録増</th>
            <th className="px-2 py-2 text-right font-medium">平均視聴%</th>
            <th className="px-2 py-2 text-right font-medium">CTR%</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.year_month} className="border-b last:border-0">
              <td className="px-2 py-2 whitespace-nowrap font-medium">{ymLabel(r.year_month)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{formatNumber(r.view_count)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{formatNumber(r.impressions)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{formatNumber(r.unique_viewers)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{formatNumber(r.new_viewers)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{formatNumber(r.repeat_viewers)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{formatNumber(r.total_watch_time_hours)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{formatNumber(r.subscribers)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{pct(r.avg_view_percentage)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{pct(r.impressions_ctr)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
