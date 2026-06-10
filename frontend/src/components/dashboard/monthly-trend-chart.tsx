"use client";

// 月次推移グラフ。指標の切替（segment は親が制御し表と連動）。棒グラフ＋ホバー数値。

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatNumber } from "@/lib/format";
import type { MonthlyMetricPoint } from "@/types/dashboard";

const SELF_BLUE = "#2563eb";

const METRICS: { key: keyof MonthlyMetricPoint; label: string }[] = [
  { key: "view_count", label: "再生数" },
  { key: "impressions", label: "インプレッション" },
  { key: "total_watch_time_hours", label: "総再生時間(h)" },
  { key: "subscribers", label: "登録増" },
  { key: "new_viewers", label: "新規視聴者" },
];

function compact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function ymShort(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  return m ? `${m[1].slice(2)}/${m[2]}` : ym;
}

interface TooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: Array<{ value: number }>;
}

function ChartTooltip({ active, label, payload, metricLabel }: TooltipProps & { metricLabel: string }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2 text-xs shadow-sm">
      <div className="font-medium">{String(label)}</div>
      <div className="mt-1 flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-blue-600" />
        {metricLabel}: <span className="font-semibold tabular-nums">{formatNumber(payload[0].value)}</span>
      </div>
    </div>
  );
}

export function MonthlyTrendChart({ items }: { items: MonthlyMetricPoint[] }) {
  const [metric, setMetric] = useState<keyof MonthlyMetricPoint>("view_count");
  const metricLabel = METRICS.find((m) => m.key === metric)?.label ?? "";

  const data = items.map((it) => ({
    ym: ymShort(it.year_month),
    value: (it[metric] as number | null) ?? 0,
  }));

  return (
    <div className="space-y-3">
      {/* 指標切替 */}
      <div className="flex flex-wrap gap-1.5">
        {METRICS.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMetric(m.key)}
            className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
              metric === m.key
                ? "border-blue-500 bg-blue-50 text-blue-700"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {data.length === 0 ? (
        <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
          データがありません
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef0f2" vertical={false} />
            <XAxis
              dataKey="ym"
              tick={{ fontSize: 12, fill: "#71717a" }}
              tickLine={false}
              axisLine={{ stroke: "#e4e4e7" }}
              tickMargin={8}
            />
            <YAxis
              tickFormatter={compact}
              tick={{ fontSize: 12, fill: "#71717a" }}
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              width={52}
            />
            <Tooltip content={<ChartTooltip metricLabel={metricLabel} />} cursor={{ fill: "#f1f5f9" }} />
            <Bar dataKey="value" fill={SELF_BLUE} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
