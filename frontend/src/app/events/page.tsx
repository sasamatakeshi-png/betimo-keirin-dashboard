"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getEvents, getVideos } from "@/lib/api";
import { formatDate, formatNumber } from "@/lib/format";
import type { EventLite } from "@/types/video";

const GRADES = ["G1", "G2", "G3", "F1", "F2"];

export default function EventsPage() {
  const [events, setEvents] = useState<EventLite[]>([]);
  const [videoCounts, setVideoCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [grade, setGrade] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // 番組数は /api/events に無いため、全動画から event_id 別に集計（読み出しのみ）
  useEffect(() => {
    getVideos({ content_type: "all", limit: 200 })
      .then((p) => {
        const m = new Map<string, number>();
        for (const v of p.items) {
          if (v.event_id) m.set(v.event_id, (m.get(v.event_id) ?? 0) + 1);
        }
        setVideoCounts(m);
      })
      .catch(() => {
        /* 件数は欠落しても一覧は表示 */
      });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await getEvents({
        q,
        grade,
        date_from: dateFrom,
        date_to: dateTo,
        order: "desc",
        limit: 200,
      });
      setEvents(page.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, [q, grade, dateFrom, dateTo]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  const sel = "rounded-md border px-2 py-1.5 text-sm";

  const sortedEvents = useMemo(
    () =>
      [...events].sort((a, b) =>
        (b.start_date ?? "").localeCompare(a.start_date ?? ""),
      ),
    [events],
  );

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-8">
      <header className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">イベント</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          開催 {events.length} 件 ・ クリックで詳細
        </p>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="フリーワード（イベント名）"
          className={`${sel} w-56`}
        />
        <select value={grade} onChange={(e) => setGrade(e.target.value)} className={sel}>
          <option value="">全グレード</option>
          {GRADES.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={sel} />
        <span className="text-sm text-muted-foreground">〜</span>
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={sel} />
        <button
          type="button"
          onClick={() => {
            setQ("");
            setGrade("");
            setDateFrom("");
            setDateTo("");
          }}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
        >
          リセット
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 p-6 text-center text-sm text-red-600">
          {error}
        </div>
      ) : loading ? (
        <div className="rounded-lg border p-12 text-center text-sm text-muted-foreground">
          読み込み中…
        </div>
      ) : sortedEvents.length === 0 ? (
        <div className="rounded-lg border p-12 text-center text-sm text-muted-foreground">
          該当イベントがありません
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sortedEvents.map((ev) => (
            <Link key={ev.id} href={`/events/${ev.id}`}>
              <Card className="h-full border-l-4 border-l-blue-500 transition-colors hover:bg-muted/40">
                <CardContent className="px-5 py-4">
                  <div className="flex items-center gap-2">
                    {ev.grade && <Badge variant="outline">{ev.grade}</Badge>}
                    {ev.venue && (
                      <span className="text-xs text-muted-foreground">{ev.venue}</span>
                    )}
                  </div>
                  <div className="mt-2 line-clamp-2 font-medium">{ev.name}</div>
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {formatDate(ev.start_date)} 〜 {formatDate(ev.end_date)}
                    </span>
                    <span className="tabular-nums">
                      {formatNumber(videoCounts.get(ev.id) ?? 0)} 番組
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
