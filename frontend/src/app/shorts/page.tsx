"use client";

// ショート専用一覧。content_type='short' のみを表示する（通常動画は /videos）。
// 表・編集・詳細導線は既存の全データ一覧コンポーネントを流用する。

import { useCallback, useEffect, useMemo, useState } from "react";

import { LoginDialog } from "@/components/auth/login-dialog";
import { EditVideoDialog } from "@/components/videos/edit-video-dialog";
import { VideosTable } from "@/components/videos/videos-table";
import { getEvents, getVideos } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { exportVideosCsv } from "@/lib/csv";
import type { EventLite, Video } from "@/types/video";

export default function ShortsPage() {
  const { canEdit } = useAuth();

  const [videos, setVideos] = useState<Video[]>([]);
  const [events, setEvents] = useState<EventLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // フィルタ（種別は short 固定なのでセレクタは無し）
  const [q, setQ] = useState("");
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

  useEffect(() => {
    getEvents({ limit: 200, order: "desc" })
      .then((p) => setEvents(p.items))
      .catch(() => {
        /* レース名は title フォールバックで継続 */
      });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await getVideos({
        q,
        content_type: "short",
        date_from: dateFrom,
        date_to: dateTo,
        include: "metrics",
        limit: 200,
        offset: 0,
        order: "desc",
      });
      setVideos(page.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, [q, dateFrom, dateTo]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  function resetFilters() {
    setQ("");
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
          <h1 className="text-2xl font-bold tracking-tight">ショート</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            ショート動画 {videos.length} 件（取り込みは「取り込み」ページのショートCSVから）
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
          placeholder="フリーワード（タイトル）"
          className={`${sel} w-56`}
        />
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={sel} />
        <span className="text-sm text-muted-foreground">〜</span>
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={sel} />
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
