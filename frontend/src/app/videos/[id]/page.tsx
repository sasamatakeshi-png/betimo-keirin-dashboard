"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
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

import { AIAnalysisCard } from "@/components/analysis/ai-analysis-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, getEvent, getTimeseries, getVideo } from "@/lib/api";
import {
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPercent,
} from "@/lib/format";
import type { TimeseriesPoint, Video } from "@/types/video";

const BLUE = "#2563eb";
const AMBER = "#d97706";

type Fmt = (n: number | null | undefined) => string;

const METRICS: { label: string; key: string; fmt: Fmt }[] = [
  { label: "imp", key: "imp", fmt: formatNumber },
  { label: "再生数", key: "view_count", fmt: formatNumber },
  { label: "登録数", key: "subscriber_gain", fmt: formatNumber },
  { label: "UU数", key: "unique_viewers", fmt: formatNumber },
  { label: "ライブ視聴", key: "live_views", fmt: formatNumber },
  { label: "アーカイブ視聴", key: "archive_views", fmt: formatNumber },
  { label: "平均同接", key: "avg_concurrent_viewers", fmt: formatNumber },
  { label: "最大同接", key: "max_concurrent_viewers", fmt: formatNumber },
  { label: "平均視聴時間", key: "avg_view_duration", fmt: formatDuration },
  { label: "平均再生率", key: "avg_view_percentage", fmt: formatPercent },
  { label: "リピーター比率", key: "repeater_ratio", fmt: formatPercent },
];

export default function VideoDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [video, setVideo] = useState<Video | null>(null);
  const [eventName, setEventName] = useState<string | null>(null);
  const [ccu, setCcu] = useState<TimeseriesPoint[]>([]);
  const [chat, setChat] = useState<TimeseriesPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setNotFound(false);
    getVideo(id)
      .then((v) => {
        if (!alive) return;
        setVideo(v);
        if (v.event_id) {
          getEvent(v.event_id)
            .then((e) => alive && setEventName(e.name))
            .catch(() => {});
        }
        // 時系列（未投入なら空。エラーにしない）
        getTimeseries(id, "concurrent_viewers")
          .then((p) => alive && setCcu(p.items))
          .catch(() => {});
        getTimeseries(id, "chat_count")
          .then((p) => alive && setChat(p.items))
          .catch(() => {});
      })
      .catch((e) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 404) setNotFound(true);
        else setError(e instanceof Error ? e.message : "読み込みに失敗しました");
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id]);

  const tsData = useMemo(() => {
    const byElapsed = new Map<number, { elapsed: number; ccu?: number; chat?: number }>();
    for (const p of ccu) byElapsed.set(p.elapsed_seconds, { ...(byElapsed.get(p.elapsed_seconds) ?? { elapsed: p.elapsed_seconds }), ccu: p.value });
    for (const p of chat) byElapsed.set(p.elapsed_seconds, { ...(byElapsed.get(p.elapsed_seconds) ?? { elapsed: p.elapsed_seconds }), chat: p.value });
    return [...byElapsed.values()].sort((a, b) => a.elapsed - b.elapsed);
  }, [ccu, chat]);

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-6xl px-6 py-12 text-center text-sm text-muted-foreground">
        読み込み中…
      </main>
    );
  }
  if (notFound) {
    return (
      <main className="mx-auto w-full max-w-6xl px-6 py-12 text-center text-sm text-muted-foreground">
        番組が見つかりません
      </main>
    );
  }
  if (error || !video) {
    return (
      <main className="mx-auto w-full max-w-6xl px-6 py-12">
        <div className="rounded-lg border border-red-200 p-6 text-center text-sm text-red-600">
          {error ?? "読み込みに失敗しました"}
        </div>
      </main>
    );
  }

  const m = video.metrics ?? {};
  const live = m.live_views ?? null;
  const archive = m.archive_views ?? null;
  const breakdownTotal = (live ?? 0) + (archive ?? 0);

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-6 py-8">
      {/* a. ヘッダー */}
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {video.program_type && <Badge variant="secondary">{video.program_type}</Badge>}
          {video.grade && <Badge variant="outline">{video.grade}</Badge>}
          <span className="text-sm text-muted-foreground">
            {video.published_at ? formatDateTime(new Date(video.published_at)) : "—"}
          </span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{video.title}</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {video.event_id && eventName && (
            <Link href={`/events/${video.event_id}`} className="text-blue-600 hover:underline">
              {eventName}
            </Link>
          )}
          {video.cast_members.length > 0 && <span>出演: {video.cast_members.join("・")}</span>}
          {video.youtube_video_id ? (
            <a
              href={`https://youtu.be/${video.youtube_video_id}`}
              target="_blank"
              rel="noreferrer"
              className="text-blue-600 hover:underline"
            >
              YouTubeで開く ↗（{video.youtube_video_id}）
            </a>
          ) : (
            <span>動画ID: —</span>
          )}
        </div>
        {video.thumbnail_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={video.thumbnail_url} alt={video.title} className="mt-2 max-w-md rounded-lg border" />
        )}
      </header>

      {/* b. 数値カード（主要11指標） */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {METRICS.map((mt) => (
          <Card key={mt.key} className="border-l-4 border-l-blue-500">
            <CardContent className="px-4 py-3">
              <div className="text-xs text-muted-foreground">{mt.label}</div>
              <div className="mt-1 text-xl font-bold tabular-nums tracking-tight">
                {mt.fmt(m[mt.key] ?? null)}
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      {/* c. 同接×チャット 時系列 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">同接・チャット 時系列</CardTitle>
          <Link
            href={`/concurrent-analysis?ids=${video.id}`}
            className="text-sm text-blue-600 hover:underline"
          >
            同接分析で比較 →
          </Link>
        </CardHeader>
        <CardContent>
          {tsData.length === 0 ? (
            <div className="flex h-[120px] items-center justify-center text-sm text-muted-foreground">
              時系列データ未取得
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={tsData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef0f2" vertical={false} />
                <XAxis dataKey="elapsed" tick={{ fontSize: 12, fill: "#71717a" }} tickLine={false} axisLine={{ stroke: "#e4e4e7" }} tickFormatter={(s: number) => `${Math.floor(s / 60)}分`} />
                <YAxis yAxisId="ccu" tick={{ fontSize: 12, fill: "#71717a" }} tickLine={false} axisLine={false} width={48} />
                <YAxis yAxisId="chat" orientation="right" tick={{ fontSize: 12, fill: "#71717a" }} tickLine={false} axisLine={false} width={48} />
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e4e4e7", fontSize: 12 }} />
                <Legend />
                <Line yAxisId="ccu" type="monotone" dataKey="ccu" name="同接" stroke={BLUE} strokeWidth={2} dot={false} />
                <Line yAxisId="chat" type="monotone" dataKey="chat" name="チャット(累計)" stroke={AMBER} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* d. ライブ/アーカイブ内訳 */}
      {(live !== null || archive !== null) && breakdownTotal > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ライブ / アーカイブ内訳</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex h-4 w-full overflow-hidden rounded">
              <div className="h-full bg-blue-500" style={{ width: `${((live ?? 0) / breakdownTotal) * 100}%` }} />
              <div className="h-full bg-zinc-400" style={{ width: `${((archive ?? 0) / breakdownTotal) * 100}%` }} />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                <span className="mr-1 inline-block h-2 w-2 rounded-full bg-blue-500" />
                ライブ視聴 {formatNumber(live)}
              </span>
              <span>
                <span className="mr-1 inline-block h-2 w-2 rounded-full bg-zinc-400" />
                アーカイブ視聴 {formatNumber(archive)}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* e. AI分析 */}
      <AIAnalysisCard entityType="videos" entityId={id} screenType="video_detail" />
    </main>
  );
}
