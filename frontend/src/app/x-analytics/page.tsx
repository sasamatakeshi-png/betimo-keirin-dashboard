"use client";

// P14 Xアナリティクス: X（旧Twitter）日別メトリクスの期間サマリ・推移・日別テーブル。
// 期間計と「前期間（同じ日数だけ前にずらした直前の等長期間）」計・前期間比を表示する。
// 配色は自社=青系（既存ダッシュボードの設計方針に合わせる）。

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { CalendarDays } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, type DateRange } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatChangeBadge, formatNumber } from "@/lib/format";
import { getXAnalyticsDaily } from "@/lib/api";
import type { XAnalyticsDailyResponse, XDailyPoint } from "@/types/x-analytics";

const SELF_BLUE = "#2563eb";
const FOLLOW_GREEN = "#16a34a";

const BADGE_STYLE: Record<string, string> = {
  up: "bg-green-50 text-green-700 border border-green-200",
  down: "bg-red-50 text-red-700 border border-red-200",
  flat: "bg-muted text-muted-foreground border",
};

// KPIカードに出す主要指標。
const KPI_METRICS: { key: string; label: string }[] = [
  { key: "posts_created", label: "投稿数" },
  { key: "imp", label: "インプレッション" },
  { key: "engagements", label: "エンゲージメント" },
  { key: "follows_gained", label: "新規フォロー" },
  { key: "profile_visits", label: "プロフィールアクセス" },
];

// 日別テーブルの列（左から）。
const TABLE_COLS: { key: keyof XDailyPoint; label: string }[] = [
  { key: "posts_created", label: "投稿数" },
  { key: "imp", label: "インプレ" },
  { key: "likes", label: "いいね" },
  { key: "engagements", label: "エンゲージ" },
  { key: "follows_gained", label: "新規フォロー" },
  { key: "unfollows", label: "フォロー解除" },
  { key: "replies", label: "返信" },
  { key: "reposts", label: "リポスト" },
  { key: "profile_visits", label: "プロフ訪問" },
];

type Preset = "7" | "28" | "all" | "custom";

function mdLabel(iso: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[1]}/${m[2]}` : iso;
}

// カレンダートリガーに出す範囲ラベル（yyyy/mm/dd 〜 yyyy/mm/dd）。
function rangeLabel(from?: string, to?: string): string {
  if (!from || !to) return "期間を選択";
  const f = from.replace(/-/g, "/");
  const t = to.replace(/-/g, "/");
  return `${f} 〜 ${t}`;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function KpiCard({
  label,
  value,
  prev,
  ratio,
}: {
  label: string;
  value: number;
  prev: number;
  ratio: number | null;
}) {
  const badge = formatChangeBadge(ratio);
  return (
    <Card className="border-l-4 border-l-blue-500">
      <CardContent className="px-5 py-4">
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm text-muted-foreground">{label}</div>
          {badge && (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${BADGE_STYLE[badge.direction]}`}
            >
              {badge.text}
            </span>
          )}
        </div>
        <div className="mt-2 text-3xl font-bold tabular-nums tracking-tight">
          {formatNumber(value)}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          前期間 {formatNumber(prev)}
        </div>
      </CardContent>
    </Card>
  );
}

export default function XAnalyticsPage() {
  const [data, setData] = useState<XAnalyticsDailyResponse | null>(null);
  const [preset, setPreset] = useState<Preset>("28");
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  // カレンダー操作中の暫定選択（開始のみの未確定状態を保持。両端確定で range に反映）。
  const [draft, setDraft] = useState<DateRange>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getXAnalyticsDaily(range.from, range.to)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "読み込みに失敗しました"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [range]);

  // プリセット選択 → 利用可能範囲から date_from/date_to を算出して再取得。
  function selectPreset(p: Preset) {
    setPreset(p);
    if (!data || !data.available_from || !data.available_to) return;
    if (p === "all") {
      setRange({ from: data.available_from, to: data.available_to });
    } else {
      const days = p === "7" ? 7 : 28;
      const to = data.available_to;
      let from = addDaysIso(to, -(days - 1));
      if (from < data.available_from) from = data.available_from;
      setRange({ from, to });
    }
  }

  // カレンダー任意期間の確定（両端そろったら range に反映してプリセットを解除）。
  function onCalendarSelect(r: DateRange) {
    setDraft(r);
    if (r.from && r.to) {
      setRange({ from: r.from, to: r.to });
      setPreset("custom");
      setPickerOpen(false);
    }
  }

  // ポップオーバーを開くとき、暫定選択を現在の有効期間で初期化する。
  function onPickerOpenChange(open: boolean) {
    setPickerOpen(open);
    if (open) {
      setDraft({
        from: range.from ?? data?.date_from ?? undefined,
        to: range.to ?? data?.date_to ?? undefined,
      });
    }
  }

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.items.map((it) => ({
      d: mdLabel(it.date),
      imp: it.imp ?? 0,
      follows: it.follows_gained ?? 0,
    }));
  }, [data]);

  const totals = data?.period_totals ?? {};
  const prevTotals = data?.prev_period_totals ?? {};
  const ratios = data?.change_ratios ?? {};

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Xアナリティクス</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            X（旧Twitter）の日別指標。期間計と前期間（同じ日数だけ前の期間）との比較を表示します
          </p>
        </div>
        {/* 期間プリセット（クイック選択）＋ カレンダー（任意期間） */}
        <div className="flex flex-wrap items-center gap-1.5">
          {(["7", "28", "all"] as Preset[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => selectPreset(p)}
              className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                preset === p
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {p === "all" ? "全期間" : `直近${p}日`}
            </button>
          ))}
          {/* 任意期間のカレンダー範囲ピッカー（選択可能範囲は実データに限定） */}
          <Popover open={pickerOpen} onOpenChange={onPickerOpenChange}>
            <PopoverTrigger
              disabled={!data?.available_from || !data?.available_to}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors disabled:pointer-events-none disabled:opacity-50 ${
                preset === "custom"
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              <CalendarDays className="size-3.5" />
              {preset === "custom"
                ? rangeLabel(range.from, range.to)
                : "期間を指定"}
            </PopoverTrigger>
            <PopoverContent align="end">
              <Calendar
                selected={draft}
                onSelect={onCalendarSelect}
                min={data?.available_from ?? undefined}
                max={data?.available_to ?? undefined}
              />
              {data?.available_from && data?.available_to && (
                <p className="mt-2 border-t pt-2 text-[0.7rem] text-muted-foreground">
                  選択可能：{data.available_from.replace(/-/g, "/")} 〜{" "}
                  {data.available_to.replace(/-/g, "/")}
                </p>
              )}
            </PopoverContent>
          </Popover>
        </div>
      </header>

      {error ? (
        <div className="rounded-lg border border-red-200 p-6 text-center text-sm text-red-600">
          {error}
        </div>
      ) : loading && !data ? (
        <div className="rounded-lg border p-12 text-center text-sm text-muted-foreground">
          読み込み中…
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="rounded-lg border p-12 text-center text-sm text-muted-foreground">
          Xの日別データがありません（CSV未取り込み）
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            対象期間 {data.date_from} 〜 {data.date_to}（前期間 {data.prev_date_from} 〜{" "}
            {data.prev_date_to}）
          </p>

          {/* 1. 期間サマリKPI */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {KPI_METRICS.map((m) => (
              <KpiCard
                key={m.key}
                label={m.label}
                value={totals[m.key] ?? 0}
                prev={prevTotals[m.key] ?? 0}
                ratio={ratios[m.key] ?? null}
              />
            ))}
          </div>

          {/* 2. 推移グラフ（日別インプレッション=棒/左軸・新規フォロー=線/右軸の2軸） */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">推移（インプレッション × 新規フォロー）</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef0f2" vertical={false} />
                  <XAxis
                    dataKey="d"
                    tick={{ fontSize: 11, fill: "#71717a" }}
                    tickLine={false}
                    axisLine={{ stroke: "#e4e4e7" }}
                    minTickGap={16}
                  />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 11, fill: "#71717a" }}
                    tickLine={false}
                    axisLine={false}
                    width={52}
                    tickFormatter={(v: number) => formatNumber(v)}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 11, fill: "#71717a" }}
                    tickLine={false}
                    axisLine={false}
                    width={44}
                    tickFormatter={(v: number) => formatNumber(v)}
                  />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: "1px solid #e4e4e7", fontSize: 12 }}
                    formatter={(value, name) => [formatNumber(Number(value)), String(name)]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    yAxisId="left"
                    dataKey="imp"
                    name="インプレッション"
                    fill={SELF_BLUE}
                    radius={[3, 3, 0, 0]}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="follows"
                    name="新規フォロー"
                    stroke={FOLLOW_GREEN}
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
              <p className="mt-2 text-xs text-muted-foreground">
                左軸=インプレッション（棒）／右軸=新規フォロー（線）。
              </p>
            </CardContent>
          </Card>

          {/* 3. 日別テーブル（最下部に期間計・前期間計） */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">日別データ</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-2 py-2 font-medium">日付</th>
                      {TABLE_COLS.map((c) => (
                        <th key={c.key} className="px-2 py-2 text-right font-medium whitespace-nowrap">
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((it) => (
                      <tr key={it.date} className="border-b last:border-0">
                        <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">{mdLabel(it.date)}</td>
                        {TABLE_COLS.map((c) => (
                          <td key={c.key} className="px-2 py-1.5 text-right tabular-nums">
                            {formatNumber(it[c.key] as number | null)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 font-medium">
                      <td className="px-2 py-2 whitespace-nowrap">期間計</td>
                      {TABLE_COLS.map((c) => (
                        <td key={c.key} className="px-2 py-2 text-right tabular-nums">
                          {formatNumber(totals[c.key as string] ?? 0)}
                        </td>
                      ))}
                    </tr>
                    <tr className="text-muted-foreground">
                      <td className="px-2 py-2 whitespace-nowrap">前期間計</td>
                      {TABLE_COLS.map((c) => (
                        <td key={c.key} className="px-2 py-2 text-right tabular-nums">
                          {formatNumber(prevTotals[c.key as string] ?? 0)}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}
