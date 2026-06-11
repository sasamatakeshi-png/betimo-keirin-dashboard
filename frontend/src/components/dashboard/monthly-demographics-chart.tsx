"use client";

// 性別・年齢グラフ。対象月の views_pct を年齢層ごとに性別色分け（隣接バー）。
// 表示月は親（対象月セレクタ）が決め、dataBySegment にその月のデータが渡る。
// segment 切替（全体/ライブ/ショート）はこのコンポーネント内で独立（デフォルト全体）。

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

import type {
  DemographicItem,
  MonthlyDemographicsResponse,
  MonthlySegment,
} from "@/types/dashboard";

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

// 2 つの内訳が（年齢層×性別の views_pct まで）完全一致かどうか。
// 月によっては YouTube の「全体」エクスポートが「ライブ」と同一になる（ライブが視聴の大半を占める月）。
// その場合は全体/ライブで見た目が変わらず混乱するため、注記を出すための判定に使う。
function sameBreakdown(
  a: MonthlyDemographicsResponse | undefined,
  b: MonthlyDemographicsResponse | undefined,
): boolean {
  const A = a?.items ?? [];
  const B = b?.items ?? [];
  if (A.length === 0 || A.length !== B.length) return false;
  const key = (it: DemographicItem) => `${it.age_band}|${it.gender}`;
  const mb = new Map(B.map((it) => [key(it), it.views_pct ?? 0]));
  if (mb.size !== A.length) return false;
  return A.every((it) => mb.get(key(it)) === (it.views_pct ?? 0));
}

export function MonthlyDemographicsChart({
  dataBySegment,
  loading = false,
  yearMonth = null,
}: {
  dataBySegment: Record<MonthlySegment, MonthlyDemographicsResponse> | undefined;
  // 対象月変更にともなう再フェッチ中フラグ
  loading?: boolean;
  // 再フェッチ中など resp 未取得時に見出しへ表示する対象月（'YYYY-MM'）
  yearMonth?: string | null;
}) {
  const [segment, setSegment] = useState<MonthlySegment>("all");
  const resp = dataBySegment?.[segment];

  // この月は「全体」と「ライブ」の内訳が元データ上まったく同一か。
  // 同一なら全体↔ライブで表示が変わらないため、バグではなく元データである旨を注記する。
  const allEqualsLive = sameBreakdown(dataBySegment?.all, dataBySegment?.live);
  const showSameNote = allEqualsLive && (segment === "all" || segment === "live");

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
        <span className="text-xs text-muted-foreground">{ymLabel(resp?.year_month ?? yearMonth)}・視聴回数%</span>
      </div>

      {showSameNote && (
        <p className="rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-700 ring-1 ring-amber-200">
          この月は「全体」と「ライブ」の元データ内訳が同一のため、両者で同じグラフになります。
        </p>
      )}

      {loading && data.length === 0 ? (
        <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
          読み込み中…
        </div>
      ) : data.length === 0 ? (
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
