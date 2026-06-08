"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { LoginDialog } from "@/components/auth/login-dialog";
import { EditVideoDialog } from "@/components/videos/edit-video-dialog";
import { VideosTable } from "@/components/videos/videos-table";
import { getAllVideos, getEvents } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { exportVideosCsv } from "@/lib/csv";
import type { EventLite, Video } from "@/types/video";

const PROGRAM_TYPES = ["あす勝ち", "BKL", "ミッドナイト", "ナイター", "プレミアムトーク", "Bar"];
const GRADES = ["G1", "G2", "G3", "F1", "F2"];

export default function VideosPage() {
  const { canEdit } = useAuth();

  const [videos, setVideos] = useState<Video[]>([]);
  const [events, setEvents] = useState<EventLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // フィルタ
  const [q, setQ] = useState("");
  const [programType, setProgramType] = useState("");
  const [grade, setGrade] = useState("");
  const [contentType, setContentType] = useState("regular");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // 編集 / ログイン
  const [editing, setEditing] = useState<Video | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);

  const eventNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of events) m.set(e.id, e.name);
    return m;
  }, [events]);

  // イベント一覧（編集ドロップダウン・レース名表示用）
  useEffect(() => {
    getEvents({ limit: 200, order: "desc" })
      .then((p) => setEvents(p.items))
      .catch(() => {
        /* 一覧表示は title フォールバックで継続 */
      });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await getAllVideos({
        q,
        program_type: programType,
        grade,
        content_type: contentType,
        date_from: dateFrom,
        date_to: dateTo,
        include: "metrics",
        order: "desc",
      });
      setVideos(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, [q, programType, grade, contentType, dateFrom, dateTo]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  function resetFilters() {
    setQ("");
    setProgramType("");
    setGrade("");
    setContentType("regular");
    setDateFrom("");
    setDateTo("");
  }

  function handleSaved(updated: Video) {
    setVideos((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
  }

  const sel = "rounded-md border px-2 py-1.5 text-sm";

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-8">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">全データ一覧</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            番組データ {videos.length} 件（既存「番組数字サマリ」の置き換え）
          </p>
        </div>
        <button
          type="button"
          onClick={() => exportVideosCsv(videos, eventNameById)}
          disabled={videos.length === 0}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
        >
          CSV出力（{videos.length}件）
        </button>
      </header>

      {/* フィルタ */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="フリーワード（レース名）"
          className={`${sel} w-56`}
        />
        <select value={programType} onChange={(e) => setProgramType(e.target.value)} className={sel}>
          <option value="">全種別</option>
          {PROGRAM_TYPES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
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
        <select value={contentType} onChange={(e) => setContentType(e.target.value)} className={sel}>
          <option value="regular">長尺</option>
          <option value="short">ショート</option>
          <option value="all">すべて</option>
        </select>
        <button type="button" onClick={resetFilters} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
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
      ) : (
        <VideosTable
          videos={videos}
          eventNameById={eventNameById}
          canEdit={canEdit}
          onEdit={(v) => {
            setEditing(v);
            setEditOpen(true);
          }}
          onRequireLogin={() => setLoginOpen(true)}
        />
      )}

      <EditVideoDialog
        open={editOpen}
        video={editing}
        events={events}
        onClose={() => setEditOpen(false)}
        onSaved={handleSaved}
        onRequireLogin={() => setLoginOpen(true)}
      />
      <LoginDialog open={loginOpen} onClose={() => setLoginOpen(false)} />
    </main>
  );
}
