"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";

import {
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPercent,
} from "@/lib/format";
import type { Video } from "@/types/video";

type Align = "left" | "right";
type SortVal = string | number | null;

interface Col {
  id: string;
  label: string;
  align: Align;
  sortable: boolean;
  sortVal?: (v: Video, raceName: string) => SortVal;
  render: (v: Video, raceName: string) => ReactNode;
}

const metric = (key: string): ((v: Video) => number | null) =>
  (v) => (v.metrics && v.metrics[key] !== undefined ? v.metrics[key] : null);

const COLS: Col[] = [
  {
    // 行頭の独立した詳細ボタン列（番組詳細へ。レース名セル=イベントへと役割分担）
    id: "detail_link",
    label: "",
    align: "left",
    sortable: false,
    render: (v) => (
      <Link
        href={`/videos/${v.id}`}
        title="番組詳細へ"
        className="rounded border px-2 py-0.5 text-xs hover:bg-muted"
      >
        詳細
      </Link>
    ),
  },
  {
    id: "published_at",
    label: "日時",
    align: "left",
    sortable: true,
    sortVal: (v) => v.published_at,
    render: (v) => (v.published_at ? formatDateTime(new Date(v.published_at)) : "—"),
  },
  {
    id: "race",
    label: "レース名",
    align: "left",
    sortable: true,
    sortVal: (_v, race) => race,
    render: (v, race) =>
      v.event_id ? (
        <Link href={`/events/${v.event_id}`} className="text-blue-600 hover:underline">
          {race || "—"}
        </Link>
      ) : (
        race || "—"
      ),
  },
  {
    id: "program_type",
    label: "番組種別",
    align: "left",
    sortable: true,
    sortVal: (v) => v.program_type,
    render: (v) => v.program_type ?? "—",
  },
  {
    id: "cast",
    label: "出演",
    align: "left",
    sortable: false,
    render: (v) => (v.cast_members.length ? v.cast_members.join("・") : "—"),
  },
  { id: "imp", label: "imp", align: "right", sortable: true, sortVal: metric("imp"), render: (v) => formatNumber(metric("imp")(v)) },
  { id: "view_count", label: "再生数", align: "right", sortable: true, sortVal: metric("view_count"), render: (v) => formatNumber(metric("view_count")(v)) },
  { id: "subscriber_gain", label: "登録数", align: "right", sortable: true, sortVal: metric("subscriber_gain"), render: (v) => formatNumber(metric("subscriber_gain")(v)) },
  { id: "unique_viewers", label: "UU数", align: "right", sortable: true, sortVal: metric("unique_viewers"), render: (v) => formatNumber(metric("unique_viewers")(v)) },
  { id: "new_viewers", label: "新規ユーザー", align: "right", sortable: true, sortVal: metric("new_viewers"), render: (v) => formatNumber(metric("new_viewers")(v)) },
  { id: "repeat_viewers", label: "リピートユーザー", align: "right", sortable: true, sortVal: metric("repeat_viewers"), render: (v) => formatNumber(metric("repeat_viewers")(v)) },
  { id: "live_views", label: "ライブ視聴", align: "right", sortable: true, sortVal: metric("live_views"), render: (v) => formatNumber(metric("live_views")(v)) },
  { id: "archive_views", label: "アーカイブ視聴", align: "right", sortable: true, sortVal: metric("archive_views"), render: (v) => formatNumber(metric("archive_views")(v)) },
  { id: "avg_concurrent_viewers", label: "平均同接", align: "right", sortable: true, sortVal: metric("avg_concurrent_viewers"), render: (v) => formatNumber(metric("avg_concurrent_viewers")(v)) },
  { id: "max_concurrent_viewers", label: "最大同接", align: "right", sortable: true, sortVal: metric("max_concurrent_viewers"), render: (v) => formatNumber(metric("max_concurrent_viewers")(v)) },
  { id: "avg_view_duration", label: "平均視聴時間", align: "right", sortable: true, sortVal: metric("avg_view_duration"), render: (v) => formatDuration(metric("avg_view_duration")(v)) },
  { id: "avg_view_percentage", label: "平均再生率", align: "right", sortable: true, sortVal: metric("avg_view_percentage"), render: (v) => formatPercent(metric("avg_view_percentage")(v)) },
  { id: "repeater_ratio", label: "リピーター比率", align: "right", sortable: true, sortVal: metric("repeater_ratio"), render: (v) => formatPercent(metric("repeater_ratio")(v)) },
  {
    id: "youtube_video_id",
    label: "動画ID",
    align: "left",
    sortable: false,
    render: (v) => v.youtube_video_id ?? "—",
  },
];

// ショート文脈で非表示にする列（番組種別/出演/ライブ・アーカイブ視聴/同接系）。
// 通常動画一覧・全データ一覧（shortMode=false）では従来どおり全列表示する。
const SHORT_HIDDEN_COLS = new Set([
  "program_type",
  "cast",
  "live_views",
  "archive_views",
  "avg_concurrent_viewers",
  "max_concurrent_viewers",
]);

const PAGE_SIZE = 50;

function cmp(a: SortVal, b: SortVal): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // null は最後
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "ja");
}

export function VideosTable({
  videos,
  eventNameById,
  canEdit,
  onEdit,
  onRequireLogin,
  shortMode = false,
}: {
  videos: Video[];
  eventNameById: Map<string, string>;
  canEdit: boolean;
  onEdit: (v: Video) => void;
  onRequireLogin: () => void;
  // ショート文脈(/shorts)で true。短尺に無関係な列を隠す。既定 false=従来表示。
  shortMode?: boolean;
}) {
  const [sortId, setSortId] = useState<string>("published_at");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);

  const cols = useMemo(
    () => (shortMode ? COLS.filter((c) => !SHORT_HIDDEN_COLS.has(c.id)) : COLS),
    [shortMode],
  );

  const raceName = (v: Video): string =>
    (v.event_id ? eventNameById.get(v.event_id) : undefined) ?? v.title;

  const sorted = useMemo(() => {
    const col = cols.find((c) => c.id === sortId);
    if (!col?.sortVal) return videos;
    const arr = [...videos];
    arr.sort((a, b) => {
      const r = cmp(col.sortVal!(a, raceName(a)), col.sortVal!(b, raceName(b)));
      return dir === "asc" ? r : -r;
    });
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videos, sortId, dir, eventNameById, cols]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const rows = sorted.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  function toggleSort(id: string) {
    if (sortId === id) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortId(id);
      setDir("desc");
    }
    setPage(0);
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-xs whitespace-nowrap">
          <thead className="bg-muted/50">
            <tr>
              {cols.map((c) => (
                <th
                  key={c.id}
                  className={`px-2 py-2 font-medium text-muted-foreground ${
                    c.align === "right" ? "text-right" : "text-left"
                  } ${c.sortable ? "cursor-pointer select-none hover:text-foreground" : ""}`}
                  onClick={c.sortable ? () => toggleSort(c.id) : undefined}
                >
                  {c.label}
                  {sortId === c.id ? (dir === "asc" ? " ▲" : " ▼") : ""}
                </th>
              ))}
              <th className="px-2 py-2 text-right font-medium text-muted-foreground">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => {
              const race = raceName(v);
              return (
                <tr key={v.id} className="border-t hover:bg-muted/30">
                  {cols.map((c) => (
                    <td
                      key={c.id}
                      className={`px-2 py-1.5 tabular-nums ${
                        c.align === "right" ? "text-right" : "text-left"
                      } ${c.id === "race" ? "max-w-[220px] truncate" : ""}`}
                      title={c.id === "race" ? race : undefined}
                    >
                      {c.render(v, race)}
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-right">
                    <div className="flex justify-end gap-1">
                      <Link
                        href={`/videos/${v.id}`}
                        className="rounded border px-2 py-0.5 text-xs hover:bg-muted"
                      >
                        詳細
                      </Link>
                      <Link
                        href={`/concurrent-analysis?ids=${v.id}`}
                        className="rounded border px-2 py-0.5 text-xs hover:bg-muted"
                      >
                        同接
                      </Link>
                      <button
                        type="button"
                        onClick={() => (canEdit ? onEdit(v) : onRequireLogin())}
                        className="rounded border px-2 py-0.5 text-xs hover:bg-muted"
                      >
                        編集
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={cols.length + 1} className="px-2 py-8 text-center text-muted-foreground">
                  該当データがありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ページング */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {sorted.length} 件中 {sorted.length === 0 ? 0 : current * PAGE_SIZE + 1}–
          {Math.min((current + 1) * PAGE_SIZE, sorted.length)} 件
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
            className="rounded border px-2 py-1 disabled:opacity-40"
          >
            前へ
          </button>
          <span>
            {current + 1} / {pageCount}
          </span>
          <button
            type="button"
            disabled={current >= pageCount - 1}
            onClick={() => setPage(current + 1)}
            className="rounded border px-2 py-1 disabled:opacity-40"
          >
            次へ
          </button>
        </div>
      </div>
    </div>
  );
}
