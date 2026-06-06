// 現在のフィルタ結果を、既存Excel「番組数字サマリ」16列でCSV出力（クライアント生成）。
// 整形済み表示値ではなく、極力「元の数値」で出力（再取り込み互換）。

import type { Video } from "@/types/video";

const HEADERS = [
  "日時",
  "レース名",
  "番組種別",
  "出演",
  "imp",
  "再生数",
  "登録数",
  "UU数",
  "ライブ視聴",
  "アーカイブ視聴",
  "平均同接",
  "最大同接",
  "平均視聴時間",
  "平均再生率",
  "リピーター比率",
  "動画ID",
];

function esc(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportVideosCsv(
  videos: Video[],
  eventNameById: Map<string, string>,
  filename = "betimo_videos.csv",
): void {
  const rows: string[][] = [HEADERS];
  for (const v of videos) {
    const m = v.metrics ?? {};
    const raceName = v.event_id
      ? (eventNameById.get(v.event_id) ?? v.title)
      : v.title;
    rows.push([
      v.published_at ?? "", // ISO（再取り込み互換のため素のまま）
      raceName,
      v.program_type ?? "",
      v.cast_members.join("・"),
      m.imp ?? "",
      m.view_count ?? "",
      m.subscriber_gain ?? "",
      m.unique_viewers ?? "",
      m.live_views ?? "",
      m.archive_views ?? "",
      m.avg_concurrent_viewers ?? "",
      m.max_concurrent_viewers ?? "",
      m.avg_view_duration ?? "", // 秒（素のまま）
      m.avg_view_percentage ?? "", // 0〜1小数（素のまま）
      m.repeater_ratio ?? "", // 0〜1小数（素のまま）
      v.youtube_video_id ?? "",
    ].map((c) => String(c)));
  }

  const csv =
    "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
