"use client";

// 性別・年齢グラフ。最新月の views_pct を年齢層ごとに性別色分け（隣接バー）。
// segment 切替は独立（デフォルト全体）。

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { MonthlyDemographicsResponse, MonthlySegment } from "@/types/dashboard";

const GENDER_COLOR: Record<string, string> = {
  male: "#2563eb", // 青
  female: "#ec4899", // ピンク
  other: "#94a3b8", // グレー
};
const GENDER_LABEL: Record<string, string> = {
  male: "男性",
  female: "女性",
  other: "その他",
};

const SEGMENTS: { key: MonthlySegment; label: string }[] = [
  { key: "all", label: "全体" },
  { key: "live", label: "ライブ" },
  { key: "short", label: "ショート" },
];

const AGE_ORDER = ["13-17", "18-24", "25-34", "35-44", "45-54", "55-64", "65-"];

function ymLabel(ym: string | null): string {
  if (!ym) return "—";
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  return m ? `${Number(m[1])}年${Number(m[2])}月時点` : ym;
}

export function MonthlyDemographicsChart({
  dataBySegment,
}: {
  dataBySegment: Record<MonthlySegment, MonthlyDemographicsResponse>;
}) {
  const [segment, setSegment] = useState<MonthlySegment>("all");
  const resp = dataBySegment[segment];

  // 年齢層 × 性別 → views_pct を組み立て（年齢順に整列）
  const byAge: Record<string, { age: string; male: number; female: number; other: number }> = {};
  for (const it of resp?.items ?? []) {
    const row = (byAge[it.age_band] ??= {
      age: it.age_band,
      male: 0,
      female: 0,
      other: 0,
    });
    if (it.gender in GENDER_COLOR) {
      row[it.gender as "male" | "female" | "other"] = it.views_pct ?? 0;
    }
  }
  const data = AGE_ORDER.filter((a) => byAge[a]).map((a) => byAge[a]);
  // AGE_ORDER に無い年齢層も末尾に拾う
  for (const a of Object.keys(byAge)) {
    if (!AGE_ORDER.includes(a)) data.push(byAge[a]);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <SegmentToggle segment={segment} onChange={setSegment} />
        <span className="text-xs text-muted-foreground">{ymLabel(resp?.year_month ?? null)}・視聴回数%</span>
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
              dataKey="age"
              tick={{ fontSize: 12, fill: "#71717a" }}
              tickLine={false}
              axisLine={{ stroke: "#e4e4e7" }}
              tickMargin={8}
            />
            <YAxis
              tickFormatter={(v) => `${v}%`}
              tick={{ fontSize: 12, fill: "#71717a" }}
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              width={44}
            />
            <Tooltip
              formatter={(value, name) => [
                `${value as number}%`,
                GENDER_LABEL[String(name)] ?? String(name),
              ]}
              cursor={{ fill: "#f1f5f9" }}
              contentStyle={{ fontSize: 12, borderRadius: 6 }}
            />
            <Legend formatter={(v) => GENDER_LABEL[v] ?? v} wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="male" fill={GENDER_COLOR.male} radius={[3, 3, 0, 0]} />
            <Bar dataKey="female" fill={GENDER_COLOR.female} radius={[3, 3, 0, 0]} />
            <Bar dataKey="other" fill={GENDER_COLOR.other} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function SegmentToggle({
  segment,
  onChange,
}: {
  segment: MonthlySegment;
  onChange: (s: MonthlySegment) => void;
}) {
  return (
    <div className="inline-flex rounded-md border p-0.5">
      {SEGMENTS.map((s) => (
        <button
          key={s.key}
          type="button"
          onClick={() => onChange(s.key)}
          className={`rounded px-3 py-1 text-xs transition-colors ${
            segment === s.key ? "bg-blue-600 text-white" : "text-muted-foreground hover:bg-muted"
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
