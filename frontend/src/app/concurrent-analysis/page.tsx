"use client";

// 同接分析: 複数番組（自社+競合）の同時接続数時系列を1チャートに重ね描き比較。
// 比較対象は ?ids=uuid1,uuid2,... で受け取り、ページ内ピッカーで増減できる。

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getChannels, getTimeseries, getVideos } from "@/lib/api";
import { formatDate, formatNumber } from "@/lib/format";
import type { Channel, TimeseriesPoint, Video } from "@/types/video";

const OWN_COLOR = "#2563eb"; // 自社=青・太線
const COMPETITOR_COLORS = ["#d97706", "#dc2626", "#16a34a", "#9333ea", "#0891b2", "#db2777"];

function shorten(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** recorded_at(UTC ISO) → JST "HH:MM" */
function fmtTimeJst(ms: number): string {
  return new Date(ms).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  });
}

interface SeriesStat {
  avg: number;
  max: number;
  count: number;
}

function calcStat(points: TimeseriesPoint[]): SeriesStat | null {
  if (points.length === 0) return null;
  const values = points.map((p) => p.value);
  return {
    avg: values.reduce((a, b) => a + b, 0) / values.length,
    max: Math.max(...values),
    count: values.length,
  };
}

function ConcurrentAnalysisInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const ids = useMemo(
    () => (searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    [searchParams],
  );

  const [candidates, setCandidates] = useState<Video[]>([]);
  const [channels, setChannels] = useState<Map<string, Channel>>(new Map());
  const [series, setSeries] = useState<Record<string, TimeseriesPoint[]>>({});
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  // 候補=自社+競合、チャンネル名はチャンネル一覧から引く
  useEffect(() => {
    let alive = true;
    Promise.all([
      getVideos({ limit: 200, order: "desc" }),
      getVideos({ limit: 200, order: "desc", is_competitor: "true" }),
      getChannels(),
    ])
      .then(([own, comp, ch]) => {
        if (!alive) return;
        setCandidates([...own.items, ...comp.items]);
        setChannels(new Map(ch.items.map((c) => [c.id, c])));
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "読み込みに失敗しました"));
    return () => {
      alive = false;
    };
  }, []);

  // 選択された番組の時系列を取得（取得済みはキャッシュ流用）
  useEffect(() => {
    const missing = ids.filter((id) => !(id in series));
    if (missing.length === 0) return;
    let alive = true;
    Promise.all(
      missing.map(async (id) => {
        try {
          const p = await getTimeseries(id, "concurrent_viewers");
          return [id, p.items] as const;
        } catch {
          return [id, [] as TimeseriesPoint[]] as const;
        }
      }),
    ).then((entries) => {
      if (alive) setSeries((s) => ({ ...s, ...Object.fromEntries(entries) }));
    });
    return () => {
      alive = false;
    };
  }, [ids, series]);

  const videoById = useMemo(() => new Map(candidates.map((v) => [v.id, v])), [candidates]);

  function setIds(next: string[]) {
    router.replace(
      next.length ? `/concurrent-analysis?ids=${next.join(",")}` : "/concurrent-analysis",
      { scroll: false },
    );
  }

  const channelName = (v: Video | undefined): string =>
    (v && channels.get(v.channel_id)?.name) ?? "—";

  // 凡例ラベル: チャンネル名（同一チャンネルが複数選択されたら番組名を短縮併記）
  const labelById = useMemo(() => {
    const chCount = new Map<string, number>();
    for (const id of ids) {
      const v = videoById.get(id);
      if (v) chCount.set(v.channel_id, (chCount.get(v.channel_id) ?? 0) + 1);
    }
    const m = new Map<string, string>();
    for (const id of ids) {
      const v = videoById.get(id);
      if (!v) {
        m.set(id, `不明な番組 (${shorten(id, 8)})`);
        continue;
      }
      const ch = shorten(channelName(v), 16);
      m.set(id, (chCount.get(v.channel_id) ?? 0) > 1 ? `${ch} / ${shorten(v.title, 10)}` : ch);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, videoById, channels]);

  // 描画対象（データあり）/ データ未取得 / 読み込み中 に分類
  const withData = ids.filter((id) => (series[id]?.length ?? 0) > 0);
  const noData = ids.filter((id) => id in series && series[id].length === 0);
  const pending = ids.filter((id) => !(id in series));

  // 線の見た目: 自社=青太線、競合=パレット順
  const lineStyle = useMemo(() => {
    const m = new Map<string, { color: string; width: number }>();
    let ci = 0;
    for (const id of withData) {
      const v = videoById.get(id);
      if (v && !v.is_competitor) {
        m.set(id, { color: OWN_COLOR, width: 3 });
      } else {
        m.set(id, { color: COMPETITOR_COLORS[ci % COMPETITOR_COLORS.length], width: 2 });
        ci += 1;
      }
    }
    return m;
  }, [withData, videoById]);

  // recorded_at（分単位に丸め）で全番組をマージ → 絶対時刻X軸
  const chartData = useMemo(() => {
    const byMinute = new Map<number, Record<string, number>>();
    for (const id of withData) {
      for (const p of series[id] ?? []) {
        if (!p.recorded_at) continue;
        const t = Math.floor(new Date(p.recorded_at).getTime() / 60000) * 60000;
        const row = byMinute.get(t) ?? { t };
        row[id] = p.value;
        byMinute.set(t, row);
      }
    }
    return [...byMinute.values()].sort((a, b) => a.t - b.t);
  }, [withData, series]);

  // ピッカー候補（検索・選択済み除外）
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return candidates.filter((v) => {
      if (ids.includes(v.id)) return false;
      if (!q) return true;
      return (
        v.title.toLowerCase().includes(q) || channelName(v).toLowerCase().includes(q)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, ids, query, channels]);

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 p-6 text-center text-sm text-red-600">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 選択中の番組（チップ） */}
      <div className="flex flex-wrap items-center gap-2">
        {ids.length === 0 ? (
          <span className="text-sm text-muted-foreground">
            番組を選んでください（下のピッカーから追加）
          </span>
        ) : (
          ids.map((id) => {
            const style = lineStyle.get(id);
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-3 py-1 text-xs"
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: style?.color ?? "#a1a1aa" }}
                />
                {labelById.get(id)}
                <button
                  type="button"
                  aria-label="選択解除"
                  onClick={() => setIds(ids.filter((x) => x !== id))}
                  className="ml-0.5 text-muted-foreground hover:text-foreground"
                >
                  ×
                </button>
              </span>
            );
          })
        )}
      </div>

      {/* チャート */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">同時接続数の推移（重ね描き）</CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <div className="flex h-[160px] items-center justify-center text-sm text-muted-foreground">
              {ids.length === 0
                ? "比較する番組を選択するとチャートが表示されます"
                : pending.length > 0
                  ? "読み込み中…"
                  : "選択した番組に時系列データがありません"}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={360}>
              <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef0f2" vertical={false} />
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tick={{ fontSize: 12, fill: "#71717a" }}
                  tickLine={false}
                  axisLine={{ stroke: "#e4e4e7" }}
                  tickFormatter={fmtTimeJst}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: "#71717a" }}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  tickFormatter={(v: number) => formatNumber(v)}
                />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: "1px solid #e4e4e7", fontSize: 12 }}
                  labelFormatter={(t) => `JST ${fmtTimeJst(Number(t))}`}
                  formatter={(value, name) => [formatNumber(Number(value)), String(name)]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {withData.map((id) => {
                  const style = lineStyle.get(id)!;
                  return (
                    <Line
                      key={id}
                      type="monotone"
                      dataKey={id}
                      name={labelById.get(id)}
                      stroke={style.color}
                      strokeWidth={style.width}
                      dot={false}
                      connectNulls
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          )}
          {noData.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              時系列データ未取得のため表示対象外: {noData.map((id) => labelById.get(id)).join("、")}
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            X軸=取得時刻(JST)。自社は青の太線、競合は細線で表示。
          </p>
        </CardContent>
      </Card>

      {/* 比較表 */}
      {withData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">比較表（スナップショット同接ベース）</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-2 py-2 font-medium">チャンネル</th>
                    <th className="px-2 py-2 font-medium">番組タイトル</th>
                    <th className="px-2 py-2 text-right font-medium">平均同接</th>
                    <th className="px-2 py-2 text-right font-medium">最大同接</th>
                    <th className="px-2 py-2 text-right font-medium">データ点数</th>
                  </tr>
                </thead>
                <tbody>
                  {withData.map((id) => {
                    const v = videoById.get(id);
                    const stat = calcStat(series[id] ?? []);
                    const style = lineStyle.get(id);
                    return (
                      <tr key={id} className="border-b last:border-0">
                        <td className="px-2 py-2">
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="inline-block h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: style?.color ?? "#a1a1aa" }}
                            />
                            {channelName(v)}
                            {v && !v.is_competitor && (
                              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">
                                自社
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="max-w-[320px] truncate px-2 py-2" title={v?.title}>
                          {v ? (
                            <Link href={`/videos/${v.id}`} className="text-blue-600 hover:underline">
                              {v.title}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {formatNumber(stat?.avg ?? null)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {formatNumber(stat?.max ?? null)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">{stat?.count ?? 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              ※ 平均・最大は約30分おきのスナップショット同接から全番組同一の方法で算出。
              KPIカード等の最大同接（YouTubeアナリティクス集計由来）とは集計方法が異なるため一致しません。
            </p>
          </CardContent>
        </Card>
      )}

      {/* 番組ピッカー */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">番組を追加</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="番組タイトル・チャンネル名で検索"
            className="w-full max-w-md rounded-md border px-3 py-1.5 text-sm"
          />
          <div className="max-h-64 overflow-y-auto rounded-md border">
            {candidates.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">読み込み中…</div>
            ) : filtered.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                該当する番組がありません
              </div>
            ) : (
              filtered.slice(0, 50).map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setIds([...ids, v.id])}
                  className="flex w-full items-center gap-2 border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-muted/40"
                >
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                      v.is_competitor
                        ? "bg-amber-50 text-amber-700"
                        : "bg-blue-50 text-blue-700"
                    }`}
                  >
                    {v.is_competitor ? "競合" : "自社"}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDate(v.published_at)}
                  </span>
                  <span className="truncate">{v.title}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {shorten(channelName(v), 14)}
                  </span>
                </button>
              ))
            )}
          </div>
          {filtered.length > 50 && (
            <p className="text-xs text-muted-foreground">
              {filtered.length} 件中 50 件を表示中（検索で絞り込めます）
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function ConcurrentAnalysisPage() {
  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">同接分析</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          複数番組（自社・競合）の同時接続数を重ね描きで比較します
        </p>
      </header>
      <Suspense
        fallback={
          <div className="rounded-lg border p-12 text-center text-sm text-muted-foreground">
            読み込み中…
          </div>
        }
      >
        <ConcurrentAnalysisInner />
      </Suspense>
    </main>
  );
}
