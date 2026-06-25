"use client";

// P12 トラフィックソース: チャンネル全体の流入ソース別集計（視聴回数ベース・構成比）と
// 関連動画Top。データは月単位（year_month）のため月セレクタで切り替える。
// 配色は自社=青系（既存ダッシュボードの設計方針に合わせる）。

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTrafficSources } from "@/lib/api";
import { formatDuration, formatNumber, formatPercent } from "@/lib/format";
import type { TrafficSourcesResponse } from "@/types/traffic";

// 自社=青系。構成比の大きい順に濃→淡のグラデーションで塗り分ける。
const BLUE_SHADES = [
  "#1d4ed8",
  "#2563eb",
  "#3b82f6",
  "#60a5fa",
  "#93c5fd",
  "#bfdbfe",
];

function shorten(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function ymLabel(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  return m ? `${m[1]}年${m[2]}月` : ym;
}

// 外部ソースがホスト名/URLらしければ遷移用URLを返す（"Google Search" 等のラベルは null）。
function externalHref(sourceKey: string): string | null {
  const s = sourceKey.trim();
  if (/^https?:\/\//i.test(s)) return s;
  // 空白を含まず、ドット区切りのドメインに見えるものだけリンク化する。
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(s)) return `https://${s}`;
  return null;
}

interface BarTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: { name: string; view_count: number; share: number | null } }>;
}

function BarTooltip({ active, payload }: BarTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2 text-xs shadow-sm">
      <div className="font-medium">{p.name}</div>
      <div className="mt-1 tabular-nums">
        視聴回数 {formatNumber(p.view_count)}
        <span className="ml-2 text-muted-foreground">{formatPercent(p.share)}</span>
      </div>
    </div>
  );
}

export default function TrafficSourcesPage() {
  const [data, setData] = useState<TrafficSourcesResponse | null>(null);
  const [yearMonth, setYearMonth] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getTrafficSources(yearMonth || undefined)
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
  }, [yearMonth]);

  // 横棒グラフ用データ（視聴回数の降順。上位8件＋以降は「その他」に集約）。
  const chartData = useMemo(() => {
    if (!data) return [];
    const withVc = data.sources.filter((s) => (s.view_count ?? 0) > 0);
    const TOP = 8;
    const top = withVc.slice(0, TOP);
    const rest = withVc.slice(TOP);
    const rows = top.map((s) => ({
      name: s.source_key,
      view_count: s.view_count ?? 0,
      share: s.view_share,
    }));
    if (rest.length > 0) {
      const vc = rest.reduce((a, s) => a + (s.view_count ?? 0), 0);
      rows.push({
        name: `その他${rest.length}件`,
        view_count: vc,
        share: data.total_view_count > 0 ? vc / data.total_view_count : null,
      });
    }
    return rows;
  }, [data]);

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">トラフィックソース</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            チャンネル全体の流入ソース別の視聴回数・構成比と、関連動画からの流入Topを表示します
          </p>
        </div>
        {/* 月セレクタ（year_month 単位） */}
        {data && data.available_months.length > 0 && (
          <select
            value={data.year_month ?? ""}
            onChange={(e) => setYearMonth(e.target.value)}
            className="rounded-md border px-3 py-1.5 text-sm"
          >
            {data.available_months.map((m) => (
              <option key={m} value={m}>
                {ymLabel(m)}
              </option>
            ))}
          </select>
        )}
      </header>

      {error ? (
        <div className="rounded-lg border border-red-200 p-6 text-center text-sm text-red-600">
          {error}
        </div>
      ) : loading && !data ? (
        <div className="rounded-lg border p-12 text-center text-sm text-muted-foreground">
          読み込み中…
        </div>
      ) : !data || data.sources.length === 0 ? (
        <div className="rounded-lg border p-12 text-center text-sm text-muted-foreground">
          流入経路データがありません（CSV未取り込み）
        </div>
      ) : (
        <>
          {/* 1. 流入ソースの構成（横棒・視聴回数ベース） */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                流入ソースの構成（{ymLabel(data.year_month ?? "")}・視聴回数ベース）
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={Math.max(220, chartData.length * 40)}>
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 4, right: 64, left: 8, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef0f2" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 12, fill: "#71717a" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => formatNumber(v)}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={140}
                    tick={{ fontSize: 12, fill: "#3f3f46" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(s: string) => shorten(s, 11)}
                  />
                  <Tooltip content={<BarTooltip />} cursor={{ fill: "#f1f5f9" }} />
                  <Bar dataKey="view_count" radius={[0, 4, 4, 0]}>
                    {chartData.map((_, i) => (
                      <Cell key={i} fill={BLUE_SHADES[Math.min(i, BLUE_SHADES.length - 1)]} />
                    ))}
                    <LabelList
                      dataKey="share"
                      position="right"
                      formatter={(v) => formatPercent(typeof v === "number" ? v : null)}
                      style={{ fontSize: 11, fill: "#71717a" }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* 2. ソース別詳細テーブル */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">ソース別詳細</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-2 py-2 font-medium">ソース</th>
                      <th className="px-2 py-2 text-right font-medium">視聴回数</th>
                      <th className="px-2 py-2 text-right font-medium">構成比</th>
                      <th className="px-2 py-2 text-right font-medium">平均視聴時間</th>
                      <th className="px-2 py-2 text-right font-medium">総再生時間(h)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sources.map((s) => (
                      <tr key={s.source_key} className="border-b last:border-0">
                        <td className="px-2 py-2">{s.source_key}</td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {formatNumber(s.view_count)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {formatPercent(s.view_share)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {formatDuration(s.avg_watch_seconds)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {formatNumber(s.total_watch_hours)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 font-medium">
                      <td className="px-2 py-2">合計</td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {formatNumber(data.total_view_count)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">100.0%</td>
                      <td className="px-2 py-2 text-right">—</td>
                      <td className="px-2 py-2 text-right">—</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* 3. 関連動画Top（データがある場合のみ） */}
          {data.related_videos.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">関連動画からの流入Top10</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-3 text-xs text-muted-foreground">
                  ※ チャンネル全体の関連動画経由の流入（ライブ/アーカイブの区別はデータ上ありません）。
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="px-2 py-2 font-medium">#</th>
                        <th className="px-2 py-2 font-medium">動画タイトル</th>
                        <th className="px-2 py-2 text-right font-medium">視聴回数</th>
                        <th className="px-2 py-2 text-right font-medium">平均視聴時間</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.related_videos.map((v, i) => (
                        <tr key={v.source_key} className="border-b last:border-0">
                          <td className="px-2 py-2 tabular-nums text-muted-foreground">{i + 1}</td>
                          <td className="max-w-[460px] px-2 py-2" title={v.title ?? undefined}>
                            <a
                              href={`https://www.youtube.com/watch?v=${v.source_key}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline"
                            >
                              {v.title ?? v.source_key}
                            </a>
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {formatNumber(v.view_count)}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {formatDuration(v.avg_watch_seconds)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 4. 外部サイトTop（「外部」流入の内訳。データがある場合のみ） */}
          {data.external_sites.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">外部サイトからの流入Top10</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-3 text-xs text-muted-foreground">
                  ※ 流入ソース「外部」の内訳（外部サイト/URL別の視聴回数）。
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="px-2 py-2 font-medium">#</th>
                        <th className="px-2 py-2 font-medium">外部サイト/URL</th>
                        <th className="px-2 py-2 text-right font-medium">視聴回数</th>
                        <th className="px-2 py-2 text-right font-medium">平均視聴時間</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.external_sites.map((s, i) => {
                        const label = s.name ?? s.source_key;
                        const href = externalHref(s.source_key);
                        return (
                          <tr key={s.source_key} className="border-b last:border-0">
                            <td className="px-2 py-2 tabular-nums text-muted-foreground">
                              {i + 1}
                            </td>
                            <td className="max-w-[460px] px-2 py-2" title={label}>
                              {href ? (
                                <a
                                  href={href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:underline"
                                >
                                  {label}
                                </a>
                              ) : (
                                label
                              )}
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums">
                              {formatNumber(s.view_count)}
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums">
                              {formatDuration(s.avg_watch_seconds)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 5. YouTube検索キーワードTop（「YouTube検索」流入の内訳。データがある場合のみ） */}
          {data.search_terms.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">YouTube検索キーワードTop10</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-3 text-xs text-muted-foreground">
                  ※ 流入ソース「YouTube検索」の内訳（検索キーワード別の視聴回数）。
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="px-2 py-2 font-medium">#</th>
                        <th className="px-2 py-2 font-medium">検索キーワード</th>
                        <th className="px-2 py-2 text-right font-medium">視聴回数</th>
                        <th className="px-2 py-2 text-right font-medium">平均視聴時間</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.search_terms.map((s, i) => (
                        <tr key={s.term} className="border-b last:border-0">
                          <td className="px-2 py-2 tabular-nums text-muted-foreground">
                            {i + 1}
                          </td>
                          <td className="max-w-[460px] px-2 py-2" title={s.term}>
                            {s.term}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {formatNumber(s.view_count)}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {formatDuration(s.avg_watch_seconds)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </main>
  );
}
