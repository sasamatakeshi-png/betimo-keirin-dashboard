// 数値・日付の整形ユーティリティ（表示はフロント責務）。

const DASH = "—";

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** 3桁区切り。null は "—"。例: 3072922 → "3,072,922" */
export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return DASH;
  return Math.round(n).toLocaleString("en-US");
}

/** 0〜1小数を% へ。null は "—"。例: 0.131325 → "13.1%" */
export function formatPercent(f: number | null | undefined, digits = 1): string {
  if (f === null || f === undefined) return DASH;
  return `${(f * 100).toFixed(digits)}%`;
}

/** 秒を h:mm:ss / m:ss へ。null は "—"。例: 470 → "7:50" */
export function formatDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return DASH;
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

/** ISO/日付文字列を "YYYY/MM/DD" へ。 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${m[1]}/${m[2]}/${m[3]}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DASH;
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
}

/** 日時を "YYYY/MM/DD HH:mm" へ。 */
export function formatDateTime(date: Date): string {
  return `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(
    date.getDate(),
  )} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}
