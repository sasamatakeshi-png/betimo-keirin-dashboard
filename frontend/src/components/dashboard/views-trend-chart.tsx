"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatNumber } from "@/lib/format";
import type { EventMarker, ViewsTrendPoint } from "@/types/dashboard";

const SELF_BLUE = "#2563eb"; // 自社=青系
const MARKER_GRAY = "#94a3b8"; // イベント目印は中立グレー（青線を邪魔しない）

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function shortDate(iso: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[1]}/${m[2]}` : iso;
}

interface TooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: Array<{ payload: ViewsTrendPoint }>;
}

function ChartTooltip({ active, label, payload }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2 text-xs shadow-sm">
      <div className="font-medium">{shortDate(String(label))}</div>
      <div className="mt-1 flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-blue-600" />
        再生数: <span className="font-semibold tabular-nums">{formatNumber(p.views)}</span>
      </div>
      <div className="text-muted-foreground">番組数: {p.video_count}</div>
    </div>
  );
}

export function ViewsTrendChart({
  data,
  markers = [],
}: {
  data: ViewsTrendPoint[];
  markers?: EventMarker[];
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
        期間内のデータがありません
      </div>
    );
  }

  // 重なり防止: 主要グレードに絞る（G1優先、無ければG2）。
  // データ上に存在する日付のマーカーのみ表示。
  const dates = new Set(data.map((d) => d.date));
  const g1 = markers.filter((m) => m.grade === "G1" && dates.has(m.date));
  const g2 = markers.filter((m) => m.grade === "G2" && dates.has(m.date));
  const shown = g1.length > 0 ? g1 : g2;

  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={data} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef0f2" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={shortDate}
          tick={{ fontSize: 12, fill: "#71717a" }}
          tickLine={false}
          axisLine={{ stroke: "#e4e4e7" }}
          minTickGap={28}
        />
        <YAxis
          tickFormatter={compact}
          tick={{ fontSize: 12, fill: "#71717a" }}
          tickLine={false}
          axisLine={false}
          width={48}
        />
        <Tooltip content={<ChartTooltip />} />
        {shown.map((m) => (
          <ReferenceLine
            key={`${m.date}-${m.name}`}
            x={m.date}
            stroke={MARKER_GRAY}
            strokeDasharray="4 3"
            label={{
              value: m.grade ?? "",
              position: "top",
              fontSize: 10,
              fill: "#64748b",
            }}
          />
        ))}
        <Line
          type="monotone"
          dataKey="views"
          stroke={SELF_BLUE}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
