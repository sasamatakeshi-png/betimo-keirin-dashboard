"use client";

// 番組比較（レポートP4「番組ごと詳細数値」の再現）。
// 母集団=自社・regular・program_type ありの 142 番組（videos の歴史データ）。
// 基準1本＋比較相手（目安2〜4本）を選び、各番組の指標を列で横並び比較する。

import { useEffect, useMemo, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getProgramCandidates, getProgramDetail } from "@/lib/api";
import { formatDate, formatDuration, formatNumber, formatPercent } from "@/lib/format";
import type {
  ProgramCandidate,
  ProgramDetail,
} from "@/types/program-comparison";

const COMPARE_MAX = 4; // 比較相手の上限（基準1 + 比較4 = 最大5列）

type MetricKind = "count" | "duration" | "ratio";
interface MetricRow {
  key: keyof ProgramDetail["metrics"];
  label: string;
  kind: MetricKind;
}

// 比較表の行（指標）。順番は手作業レポートP4に合わせる。
const METRIC_ROWS: MetricRow[] = [
  { key: "view_count", label: "視聴回数", kind: "count" },
  { key: "imp", label: "インプレッション", kind: "count" },
  { key: "subscriber_gain", label: "登録増", kind: "count" },
  { key: "max_concurrent_viewers", label: "最大同接", kind: "count" },
  { key: "avg_concurrent_viewers", label: "平均同接", kind: "count" },
  { key: "live_views", label: "ライブ視聴", kind: "count" },
  { key: "archive_views", label: "アーカイブ視聴", kind: "count" },
  { key: "archive_ratio", label: "アーカイブ比率", kind: "ratio" },
  { key: "avg_view_duration", label: "平均視聴時間", kind: "duration" },
  { key: "avg_view_percentage", label: "平均視聴維持率", kind: "ratio" },
  { key: "repeater_ratio", label: "リピーター比率", kind: "ratio" },
];

function fmtValue(kind: MetricKind, v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  if (kind === "duration") return formatDuration(v);
  if (kind === "ratio") return formatPercent(v); // 0〜1 小数 → %
  return formatNumber(v);
}

// 基準との差。count/duration は相対%、ratio は ポイント差(pt)。
function diffBadge(
  kind: MetricKind,
  v: number | null | undefined,
  base: number | null | undefined,
): { text: string; dir: "up" | "down" | "flat" } | null {
  if (v === null || v === undefined || base === null || base === undefined) return null;
  if (kind === "ratio") {
    const pt = (v - base) * 100;
    const abs = Math.abs(pt).toFixed(1);
    if (pt > 0.05) return { text: `+${abs}pt`, dir: "up" };
    if (pt < -0.05) return { text: `-${abs}pt`, dir: "down" };
    return { text: "±0.0pt", dir: "flat" };
  }
  if (base === 0) return null; // 相対%が出せない
  const ratio = ((v - base) / base) * 100;
  const abs = Math.abs(ratio).toFixed(1);
  if (ratio > 0.05) return { text: `+${abs}%`, dir: "up" };
  if (ratio < -0.05) return { text: `-${abs}%`, dir: "down" };
  return { text: "±0.0%", dir: "flat" };
}

const dirColor: Record<"up" | "down" | "flat", string> = {
  up: "text-emerald-600",
  down: "text-rose-600",
  flat: "text-muted-foreground",
};

// 種別 → バッジ配色（薄背景＋濃文字）。候補一覧・比較表ヘッダで共通利用。
// キーは正規化後の値。表記ゆれ（全角/半角・Bar/バー）は canonicalProgramType で吸収。
const PROGRAM_TYPE_BADGE: Record<string, string> = {
  あす勝ち: "bg-blue-100 text-blue-700", // 青系
  BKL: "bg-red-100 text-red-700", // 薄赤系
  プレミアムトーク: "bg-yellow-100 text-yellow-800", // 薄黄系（濃い黄土）
  ミッドナイト: "bg-slate-200 text-slate-700", // 薄グレー系
  ナイター: "bg-green-100 text-green-700", // 薄緑系
  Bar: "bg-amber-100 text-amber-800", // 薄茶系
};
// その他・未定義の無難なグレー。
const PROGRAM_TYPE_BADGE_DEFAULT = "bg-gray-100 text-gray-600";

// program_type の表記ゆれを吸収して配色マップのキーに揃える。
// - NFKC で全角英数→半角（例: ＢＫＬ→BKL、Ｂａｒ→Bar）
// - Bar / バー / ばー（大小問わず）は "Bar" に統一
function canonicalProgramType(type: string): string {
  const t = type.trim().normalize("NFKC");
  if (t.toLowerCase() === "bar" || t === "バー" || t === "ばー") return "Bar";
  return t;
}

function programTypeBadgeClass(type: string): string {
  return PROGRAM_TYPE_BADGE[canonicalProgramType(type)] ?? PROGRAM_TYPE_BADGE_DEFAULT;
}

function ProgramTypeBadge({ type }: { type: string | null }) {
  if (!type) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${programTypeBadgeClass(
        type,
      )}`}
    >
      {type}
    </span>
  );
}

export default function ProgramComparisonPage() {
  // フィルタ
  const [race, setRace] = useState("");
  const [programType, setProgramType] = useState("");
  const [yearMonth, setYearMonth] = useState("");

  // 候補・選択肢
  const [candidates, setCandidates] = useState<ProgramCandidate[]>([]);
  const [programTypes, setProgramTypes] = useState<string[]>([]);
  const [yearMonths, setYearMonths] = useState<string[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 選択（基準1本 + 比較相手 複数）
  const [baseId, setBaseId] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);

  // 詳細指標
  const [detailMap, setDetailMap] = useState<Record<string, ProgramDetail>>({});

  // 候補を取得（フィルタ変更で再取得。race は軽くデバウンス）
  useEffect(() => {
    let alive = true;
    const handle = setTimeout(() => {
      setLoadingCandidates(true);
      getProgramCandidates({
        race: race.trim() || undefined,
        program_type: programType || undefined,
        year_month: yearMonth || undefined,
      })
        .then((res) => {
          if (!alive) return;
          setCandidates(res.items);
          // 選択肢は母集団全体ベース（安定）。空応答時は前回値を保持。
          if (res.program_types.length) setProgramTypes(res.program_types);
          if (res.year_months.length) setYearMonths(res.year_months);
          setError(null);
        })
        .catch((e) => {
          if (alive) setError(e instanceof Error ? e.message : "候補の取得に失敗しました");
        })
        .finally(() => {
          if (alive) setLoadingCandidates(false);
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [race, programType, yearMonth]);

  // 選択中の番組の詳細を取得
  const selectedIds = useMemo(
    () => [baseId, ...compareIds].filter((x): x is string => Boolean(x)),
    [baseId, compareIds],
  );
  const selectedKey = selectedIds.join(",");

  useEffect(() => {
    if (selectedIds.length === 0) return;
    let alive = true;
    getProgramDetail(selectedIds)
      .then((res) => {
        if (!alive) return;
        // 既存マップに統合（要求中の番組を上書き）。未選択分は columnIds 側で除外。
        setDetailMap((prev) => ({
          ...prev,
          ...Object.fromEntries(res.items.map((it) => [it.video_id, it])),
        }));
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "詳細の取得に失敗しました");
      });
    return () => {
      alive = false;
    };
    // selectedKey で依存（配列の同一性ではなく中身で判定）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  // 詳細の読み込み中＝選択済みのうち未取得がある状態（派生）。
  const loadingDetail =
    selectedIds.length > 0 && !selectedIds.every((id) => detailMap[id]);

  const candidateById = useMemo(
    () => new Map(candidates.map((c) => [c.video_id, c])),
    [candidates],
  );

  // 選択操作
  function setAsBase(id: string) {
    setCompareIds((prev) => prev.filter((x) => x !== id));
    setBaseId(id);
  }
  function addToCompare(id: string) {
    if (id === baseId) return;
    setCompareIds((prev) =>
      prev.includes(id) || prev.length >= COMPARE_MAX ? prev : [...prev, id],
    );
  }
  function removeSelected(id: string) {
    if (id === baseId) setBaseId(null);
    setCompareIds((prev) => prev.filter((x) => x !== id));
  }

  const compareFull = compareIds.length >= COMPARE_MAX;

  // 比較表の列順（基準→比較）。詳細が取れた番組のみ。
  const columnIds = selectedIds.filter((id) => detailMap[id]);
  const baseDetail = baseId ? detailMap[baseId] : undefined;

  // 選択チップ用のラベル（候補一覧 or 詳細から引く）
  const labelOf = (id: string): ProgramCandidate | ProgramDetail | undefined =>
    candidateById.get(id) ?? detailMap[id];

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">番組比較</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          基準の番組1本と比較相手（目安2〜4本）を選んで、レポートP4「番組ごと詳細数値」を横並びで比較します。
          対象は自社・ライブ番組の142本（種別が設定された歴史データ）。
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {error}
        </div>
      )}

      {/* 選択中チップ */}
      <div className="flex flex-wrap items-center gap-2">
        {selectedIds.length === 0 ? (
          <span className="text-sm text-muted-foreground">
            下の一覧から「基準にする」「比較に追加」で番組を選んでください
          </span>
        ) : (
          selectedIds.map((id) => {
            const c = labelOf(id);
            const isBase = id === baseId;
            return (
              <span
                key={id}
                className={`inline-flex max-w-[280px] items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
                  isBase
                    ? "border-blue-300 bg-blue-50 text-blue-800"
                    : "bg-muted/40"
                }`}
              >
                <span className="shrink-0 font-medium">
                  {isBase ? "基準" : "比較"}
                </span>
                <span className="truncate" title={c?.title}>
                  {c?.title ?? id}
                </span>
                <button
                  type="button"
                  aria-label="選択解除"
                  onClick={() => removeSelected(id)}
                  className="ml-0.5 shrink-0 text-muted-foreground hover:text-foreground"
                >
                  ×
                </button>
              </span>
            );
          })
        )}
      </div>

      {/* (B) 比較表 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">比較表</CardTitle>
        </CardHeader>
        <CardContent>
          {columnIds.length === 0 ? (
            <div className="flex h-[120px] items-center justify-center text-sm text-muted-foreground">
              {loadingDetail ? "読み込み中…" : "番組を選ぶと比較表が表示されます"}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left align-bottom">
                    <th className="sticky left-0 z-10 bg-card px-2 py-2 text-xs font-medium text-muted-foreground">
                      指標
                    </th>
                    {columnIds.map((id) => {
                      const d = detailMap[id];
                      const isBase = id === baseId;
                      return (
                        <th
                          key={id}
                          className={`min-w-[180px] px-3 py-2 align-top ${
                            isBase ? "bg-blue-50/60" : ""
                          }`}
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                  isBase
                                    ? "bg-blue-600 text-white"
                                    : "bg-muted text-muted-foreground"
                                }`}
                              >
                                {isBase ? "基準" : `比較${columnIds.indexOf(id)}`}
                              </span>
                              <ProgramTypeBadge type={d.program_type} />
                            </div>
                            <div
                              className="max-w-[220px] truncate text-xs font-semibold"
                              title={d.title}
                            >
                              {d.title}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {d.event_name ?? "—"}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {formatDate(d.published_at)}
                            </div>
                            <div
                              className="max-w-[220px] truncate text-[11px] text-muted-foreground"
                              title={d.cast_members.join("、")}
                            >
                              出演: {d.cast_members.length ? d.cast_members.join("、") : "—"}
                            </div>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {METRIC_ROWS.map((row) => {
                    const baseVal = baseDetail
                      ? (baseDetail.metrics[row.key] as number | null)
                      : null;
                    return (
                      <tr key={row.key} className="border-b last:border-0">
                        <td className="sticky left-0 z-10 bg-card px-2 py-2 text-xs text-muted-foreground">
                          {row.label}
                        </td>
                        {columnIds.map((id) => {
                          const d = detailMap[id];
                          const v = d.metrics[row.key] as number | null;
                          const isBase = id === baseId;
                          const badge = isBase ? null : diffBadge(row.kind, v, baseVal);
                          return (
                            <td
                              key={id}
                              className={`px-3 py-2 text-right tabular-nums ${
                                isBase ? "bg-blue-50/40 font-medium" : ""
                              }`}
                            >
                              <span>{fmtValue(row.kind, v)}</span>
                              {badge && (
                                <span className={`ml-1.5 text-[11px] ${dirColor[badge.dir]}`}>
                                  ({badge.text})
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-muted-foreground">
                括弧内は基準との差（視聴回数・同接などは相対%、比率系はポイント差pt）。欠損指標は「—」。
                平均視聴時間は m:ss 表示。比率は0〜1の値を%換算。
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* (A) 番組を選ぶ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">番組を選ぶ</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* フィルタ */}
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              レース名検索
              <input
                value={race}
                onChange={(e) => setRace(e.target.value)}
                placeholder="例: 日本選手権 / 競輪祭"
                className="w-56 rounded-md border px-3 py-1.5 text-sm text-foreground"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              種別
              <select
                value={programType}
                onChange={(e) => setProgramType(e.target.value)}
                className="w-40 rounded-md border px-2 py-1.5 text-sm text-foreground"
              >
                <option value="">すべて</option>
                {programTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              公開月
              <select
                value={yearMonth}
                onChange={(e) => setYearMonth(e.target.value)}
                className="w-36 rounded-md border px-2 py-1.5 text-sm text-foreground"
              >
                <option value="">すべて</option>
                {yearMonths.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            {(race || programType || yearMonth) && (
              <button
                type="button"
                onClick={() => {
                  setRace("");
                  setProgramType("");
                  setYearMonth("");
                }}
                className="rounded-md border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                条件クリア
              </button>
            )}
          </div>

          <div className="text-xs text-muted-foreground">
            候補 {candidates.length} 本
            {compareFull && (
              <span className="ml-2 text-amber-600">
                比較相手は最大 {COMPARE_MAX} 本です（解除すると追加できます）
              </span>
            )}
          </div>

          {/* 候補一覧 */}
          <div className="max-h-[420px] overflow-y-auto rounded-md border">
            {loadingCandidates && candidates.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">読み込み中…</div>
            ) : candidates.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                該当する番組がありません
              </div>
            ) : (
              candidates.map((c) => {
                const isBase = c.video_id === baseId;
                const isCompare = compareIds.includes(c.video_id);
                return (
                  <div
                    key={c.video_id}
                    className="flex items-center gap-2 border-b px-3 py-2 text-sm last:border-0 hover:bg-muted/30"
                  >
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDate(c.published_at)}
                    </span>
                    <ProgramTypeBadge type={c.program_type} />
                    <span className="min-w-0 flex-1 truncate" title={c.title}>
                      {c.title}
                    </span>
                    <span
                      className="hidden shrink-0 truncate text-xs text-muted-foreground sm:block sm:max-w-[140px]"
                      title={c.cast_members.join("、")}
                    >
                      {c.cast_members.join("、")}
                    </span>
                    <button
                      type="button"
                      onClick={() => setAsBase(c.video_id)}
                      disabled={isBase}
                      className={`shrink-0 rounded px-2 py-1 text-xs ${
                        isBase
                          ? "cursor-default bg-blue-600 text-white"
                          : "border text-blue-700 hover:bg-blue-50"
                      }`}
                    >
                      {isBase ? "基準" : "基準にする"}
                    </button>
                    <button
                      type="button"
                      onClick={() => addToCompare(c.video_id)}
                      disabled={isBase || isCompare || compareFull}
                      className={`shrink-0 rounded px-2 py-1 text-xs ${
                        isCompare
                          ? "cursor-default bg-zinc-700 text-white"
                          : isBase || compareFull
                            ? "cursor-not-allowed border text-muted-foreground opacity-50"
                            : "border text-foreground hover:bg-muted"
                      }`}
                    >
                      {isCompare ? "比較中" : "比較に追加"}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
