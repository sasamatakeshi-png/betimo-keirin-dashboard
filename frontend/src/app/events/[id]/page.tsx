"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, getEventSummary } from "@/lib/api";
import {
  formatDate,
  formatDuration,
  formatNumber,
  formatPercent,
} from "@/lib/format";
import type { EventSummary } from "@/types/event-summary";

const BLUE = "#2563eb";

function shortDate(iso: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[1]}/${m[2]}` : iso;
}

export default function EventDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [data, setData] = useState<EventSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setNotFound(false);
    getEventSummary(id)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 404) setNotFound(true);
        else setError(e instanceof Error ? e.message : "読み込みに失敗しました");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-7xl px-6 py-12 text-center text-sm text-muted-foreground">
        読み込み中…
      </main>
    );
  }
  if (notFound) {
    return (
      <main className="mx-auto w-full max-w-7xl px-6 py-12 text-center text-sm text-muted-foreground">
        イベントが見つかりません
      </main>
    );
  }
  if (error || !data) {
    return (
      <main className="mx-auto w-full max-w-7xl px-6 py-12">
        <div className="rounded-lg border border-red-200 p-6 text-center text-sm text-red-600">
          {error ?? "読み込みに失敗しました"}
        </div>
      </main>
    );
  }

  const { event, period_kpis: kp, programs_by_max_ccu: programs, daily_performance: daily, videos } = data;

  const kpiItems: { label: string; value: string; count: number }[] = [
    { label: "インプレッション計", value: formatNumber(kp.total_impressions.value), count: kp.total_impressions.count },
    { label: "再生数計", value: formatNumber(kp.total_views.value), count: kp.total_views.count },
    { label: "登録増計", value: formatNumber(kp.total_subscriber_gain.value), count: kp.total_subscriber_gain.count },
    { label: "平均再生率", value: formatPercent(kp.avg_view_percentage.value), count: kp.avg_view_percentage.count },
    { label: "最大同接（単一番組）", value: formatNumber(kp.max_concurrent_viewers.value), count: kp.max_concurrent_viewers.count },
  ];

  const maxCcu = Math.max(1, ...programs.map((p) => p.max_concurrent_viewers ?? 0));
  const chartData = daily.map((d) => ({ date: d.date, views: d.total_views ?? 0 }));

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-6 py-8">
      {/* a. ヘッダー */}
      <header>
        <div className="flex items-center gap-2">
          {event.grade && <Badge variant="outline">{event.grade}</Badge>}
          {event.venue && <span className="text-sm text-muted-foreground">{event.venue}</span>}
        </div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{event.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatDate(event.start_date)} 〜 {formatDate(event.end_date)}
        </p>
      </header>

      {/* b. 期間KPI */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {kpiItems.map((k) => (
          <Card key={k.label} className="border-l-4 border-l-blue-500">
            <CardContent className="px-5 py-4">
              <div className="text-sm text-muted-foreground">{k.label}</div>
              <div className="mt-1 text-2xl font-bold tabular-nums tracking-tight">{k.value}</div>
              <div className="mt-1 text-xs text-muted-foreground">{formatNumber(k.count)} 件で集計</div>
            </CardContent>
          </Card>
        ))}
      </section>

      {/* c. 番組別 最大同接ランキング */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">番組別 最大同接ランキング</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {programs.map((p, i) => {
              const ccu = p.max_concurrent_viewers ?? 0;
              const pct = (ccu / maxCcu) * 100;
              return (
                <li key={p.video_id} className="flex items-center gap-3">
                  <span className="w-6 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {p.program_type && (
                        <Badge variant="secondary" className="shrink-0 text-[10px]">
                          {p.program_type}
                        </Badge>
                      )}
                      <span className="truncate text-sm" title={p.title}>
                        {p.title}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatDate(p.published_at)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-2 flex-1 overflow-hidden rounded bg-muted">
                        <div className="h-full rounded bg-blue-500" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums">
                        {formatNumber(ccu)}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                      平均同接 {formatNumber(p.avg_concurrent_viewers)} ・ 再生 {formatNumber(p.view_count)}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {/* d. 日別パフォーマンス */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">日別パフォーマンス（JST）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef0f2" vertical={false} />
              <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 12, fill: "#71717a" }} tickLine={false} axisLine={{ stroke: "#e4e4e7" }} />
              <YAxis tick={{ fontSize: 12, fill: "#71717a" }} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
              <Tooltip
                formatter={(v) => [formatNumber(Number(v)), "再生数"]}
                labelFormatter={(l) => shortDate(String(l))}
                contentStyle={{ borderRadius: 8, border: "1px solid #e4e4e7", fontSize: 12 }}
              />
              <Bar dataKey="views" fill={BLUE} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-xs whitespace-nowrap">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">日付</th>
                  <th className="px-3 py-2 text-right">番組数</th>
                  <th className="px-3 py-2 text-right">再生数</th>
                  <th className="px-3 py-2 text-right">imp</th>
                  <th className="px-3 py-2 text-right">最大同接</th>
                </tr>
              </thead>
              <tbody>
                {daily.map((d) => (
                  <tr key={d.date} className="border-t">
                    <td className="px-3 py-1.5 text-left">{formatDate(d.date)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(d.video_count)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(d.total_views)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(d.total_impressions)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(d.max_concurrent_viewers)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* e. 番組一覧（簡易版） */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">番組一覧（{videos.length}件）</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-xs whitespace-nowrap">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">日時</th>
                  <th className="px-3 py-2 text-left">番組種別</th>
                  <th className="px-3 py-2 text-right">再生数</th>
                  <th className="px-3 py-2 text-right">最大同接</th>
                  <th className="px-3 py-2 text-right">平均視聴時間</th>
                  <th className="px-3 py-2 text-right">平均再生率</th>
                  <th className="px-3 py-2 text-left">動画ID</th>
                  <th className="px-3 py-2 text-right">詳細</th>
                </tr>
              </thead>
              <tbody>
                {videos.map((v) => {
                  const m = v.metrics ?? {};
                  return (
                    // F-6 で /videos/[id] の番組詳細を追加予定（data-video-id で導線確保）
                    <tr key={v.id} data-video-id={v.id} className="border-t hover:bg-muted/30">
                      <td className="px-3 py-1.5 text-left">{formatDate(v.published_at)}</td>
                      <td className="px-3 py-1.5 text-left">{v.program_type ?? "—"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(m.view_count ?? null)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(m.max_concurrent_viewers ?? null)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatDuration(m.avg_view_duration ?? null)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatPercent(m.avg_view_percentage ?? null)}</td>
                      <td className="px-3 py-1.5 text-left">{v.youtube_video_id ?? "—"}</td>
                      <td className="px-3 py-1.5 text-right">
                        <Link href={`/videos/${v.id}`} className="text-blue-600 hover:underline">
                          詳細
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
