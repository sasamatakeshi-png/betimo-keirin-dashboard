"use client";

// データ取り込み: 全期間CSV / 90日CSV をアップロードして metric_values へ投入し、
// 取り込み履歴(ingestion_logs)を表示する。投入は要ログイン（編集権限）。

import { useCallback, useEffect, useRef, useState } from "react";

import { LoginDialog } from "@/components/auth/login-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ApiError,
  getIngestionLogs,
  uploadIngestionCsv,
  uploadMonthlyCsv,
  uploadMonthlyVideoCsv,
  uploadShortCsv,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime, formatNumber } from "@/lib/format";
import type {
  IngestionLog,
  IngestType,
  MonthlyKind,
  MonthlySegment,
  MonthlyVideoUploadResult,
  ShortIngestType,
  UploadResult,
} from "@/types/ingestion";

const TYPE_OPTIONS: { value: IngestType; label: string; hint: string }[] = [
  { value: "zenkikan_csv", label: "全期間CSV", hint: "imp / 再生数 / 登録数 / 平均視聴時間 / 平均再生率" },
  { value: "90d_csv", label: "90日CSV", hint: "UU数 / 新規・リピーター / リピーター比率" },
];

const SHORT_TYPE_OPTIONS: { value: ShortIngestType; label: string; hint: string }[] = [
  { value: "short_zenkikan_csv", label: "ショート全期間CSV", hint: "未登録IDは新規ショートとして作成。新規/リピーターは空欄" },
  { value: "short_90d_csv", label: "ショート90日CSV", hint: "未登録IDは新規ショートとして作成。UU/新規/リピーターあり" },
];

const STATUS_BADGE: Record<string, string> = {
  success: "bg-green-50 text-green-700",
  partial: "bg-amber-50 text-amber-700",
  failed: "bg-red-50 text-red-600",
};

// --- 月次データCSV ---

const MONTHLY_KIND_OPTIONS: { value: MonthlyKind; label: string; hint: string }[] = [
  { value: "metrics", label: "数値CSV", hint: "合計行のみ採用。平均視聴時間/視聴率/UU/再生/登録/imp 等10指標" },
  { value: "demographics", label: "性別年齢CSV", hint: "年齢層×性別の 視聴回数% / 総再生時間%" },
];

const MONTHLY_SEGMENT_OPTIONS: { value: MonthlySegment; label: string }[] = [
  { value: "all", label: "全体" },
  { value: "live", label: "ライブ" },
  { value: "short", label: "ショート" },
];

const MONTHLY_KIND_LABEL: Record<MonthlyKind, string> = {
  metrics: "数値",
  demographics: "性別年齢",
};
const MONTHLY_SEGMENT_LABEL: Record<MonthlySegment, string> = {
  all: "全体",
  live: "ライブ",
  short: "ショート",
};

// 取り込み対象月の下限（2025-11 以降）
const MONTHLY_START_YEAR = 2025;
const MONTHLY_START_MONTH = 11; // 1始まり

// 2025-11 〜 当月 の 'YYYY-MM' を新しい順で生成。
function buildMonthOptions(now: Date): { value: string; label: string }[] {
  const endYear = now.getFullYear();
  const endMonth = now.getMonth() + 1; // 1始まり
  const out: { value: string; label: string }[] = [];
  let y = endYear;
  let m = endMonth;
  // 下限に達するまで1か月ずつ遡る
  while (y > MONTHLY_START_YEAR || (y === MONTHLY_START_YEAR && m >= MONTHLY_START_MONTH)) {
    out.push({ value: `${y}-${String(m).padStart(2, "0")}`, label: `${y}年${m}月` });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

// 'YYYY-MM' → '2026年5月'（結果表示用）
function formatYearMonthLabel(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return ym;
  return `${Number(m[1])}年${Number(m[2])}月`;
}

// 月次・複数ファイル投入の1行分の状態
type MonthlyRowStatus = "idle" | "uploading" | "success" | "error";
interface MonthlyRow {
  id: string;
  fileName: string;
  file: File;
  yearMonth: string;
  kind: MonthlyKind;
  segment: MonthlySegment;
  status: MonthlyRowStatus;
  message: string | null;
}

// ファイル名から 月/種別/セグメント の初期値を推測する（外れても手で変更可）。
// 規則:
//  - 種別: 「性別」「年齢」「demographic」「gender」「age」を含めば demographics、他は metrics。
//  - セグメント: 「ショート/short」→short、「ライブ/live/配信」→live、「全体/all/チャンネル」→all、既定 all。
//  - 対象月: 「YYYY-MM / YYYY_MM / YYYYMM」または「YYYY年M月」を優先。年の無い「M月」は
//    その月を持つ最新の選択肢を採用。いずれも候補に無ければ既定(最新月)。
function guessMonthlyFromName(
  name: string,
  monthOptions: { value: string }[],
  defaultYearMonth: string,
): { yearMonth: string; kind: MonthlyKind; segment: MonthlySegment } {
  let kind: MonthlyKind = "metrics";
  if (/性別|年齢|demograph|gender|age/i.test(name)) kind = "demographics";

  let segment: MonthlySegment = "all";
  if (/ショート|short/i.test(name)) segment = "short";
  else if (/ライブ|live|配信/i.test(name)) segment = "live";
  else if (/全体|all|チャンネル/i.test(name)) segment = "all";

  let yearMonth = defaultYearMonth;
  const valid = new Set(monthOptions.map((o) => o.value));
  const ym = /(20\d{2})[-_.]?(0[1-9]|1[0-2])/.exec(name);
  if (ym && valid.has(`${ym[1]}-${ym[2]}`)) {
    yearMonth = `${ym[1]}-${ym[2]}`;
  } else {
    const mm = /(\d{1,2})\s*月/.exec(name);
    const month = mm ? Number(mm[1]) : 0;
    if (month >= 1 && month <= 12) {
      const mp = String(month).padStart(2, "0");
      const yyyy = /(20\d{2})\s*年/.exec(name);
      if (yyyy && valid.has(`${yyyy[1]}-${mp}`)) {
        yearMonth = `${yyyy[1]}-${mp}`;
      } else {
        // 年指定なし → その月を持つ最新の選択肢（monthOptions は新しい順）
        const found = monthOptions.find((o) => o.value.endsWith(`-${mp}`));
        if (found) yearMonth = found.value;
      }
    }
  }
  return { yearMonth, kind, segment };
}

export default function IngestPage() {
  const { canEdit, authRequired, probed } = useAuth();

  const [type, setType] = useState<IngestType>("zenkikan_csv");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [resultFile, setResultFile] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);

  // ショートCSV（独立した投入口。通常CSVの state とは分離）
  const [shortType, setShortType] = useState<ShortIngestType>("short_zenkikan_csv");
  const [shortFile, setShortFile] = useState<File | null>(null);
  const [shortDragOver, setShortDragOver] = useState(false);
  const [shortUploading, setShortUploading] = useState(false);
  const [shortResult, setShortResult] = useState<UploadResult | null>(null);
  const [shortResultFile, setShortResultFile] = useState<string | null>(null);
  const [shortError, setShortError] = useState<string | null>(null);

  // 月次データCSV（複数ファイルをまとめて投入。通常/ショートとは独立）
  // 対象月リストは現在時刻から算出（lazy初期化。既定は最新月）。
  const [monthOptions] = useState<{ value: string; label: string }[]>(() =>
    buildMonthOptions(new Date()),
  );
  const monthlyDefaultYM = monthOptions[0]?.value ?? "";
  const [monthlyRows, setMonthlyRows] = useState<MonthlyRow[]>([]);
  const [monthlyDragOver, setMonthlyDragOver] = useState(false);
  const [monthlyBatchRunning, setMonthlyBatchRunning] = useState(false);
  const [monthlyProgress, setMonthlyProgress] = useState<{ current: number; total: number } | null>(
    null,
  );
  const [monthlySummary, setMonthlySummary] = useState<{ success: number; fail: number } | null>(
    null,
  );
  const monthlyRowIdRef = useRef(0);

  // 月次・動画別CSV（月 × 動画。WebCM切り出し基盤。他の投入口とは独立）
  const [videoYearMonth, setVideoYearMonth] = useState<string>(monthlyDefaultYM);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoDragOver, setVideoDragOver] = useState(false);
  const [videoUploading, setVideoUploading] = useState(false);
  const [videoResult, setVideoResult] = useState<MonthlyVideoUploadResult | null>(null);
  const [videoResultFile, setVideoResultFile] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);

  const [logs, setLogs] = useState<IngestionLog[]>([]);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logsLoading, setLogsLoading] = useState(true);

  // setState は Promise コールバック内のみ（effect 本体での同期 setState を避ける）
  const loadLogs = useCallback(
    () =>
      getIngestionLogs()
        .then((p) => {
          setLogs(p.items);
          setLogsError(null);
        })
        .catch((e) => {
          if (e instanceof ApiError && e.status === 401) {
            setLogsError("ログインすると取り込み履歴を表示できます");
          } else {
            setLogsError(e instanceof Error ? e.message : "履歴の取得に失敗しました");
          }
        })
        .finally(() => setLogsLoading(false)),
    [],
  );

  // 認証判定が済んでから履歴を取得（要トークンのため）
  useEffect(() => {
    if (probed) void loadLogs();
  }, [probed, canEdit, loadLogs]);

  async function handleUpload() {
    if (!file || !canEdit || uploading) return;
    setUploading(true);
    setUploadError(null);
    setResult(null);
    try {
      const r = await uploadIngestionCsv(file, type);
      setResult(r);
      setResultFile(file.name);
      setFile(null);
      setLogsLoading(true);
      void loadLogs();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "アップロードに失敗しました");
    } finally {
      setUploading(false);
    }
  }

  function pickFile(f: File | undefined | null) {
    if (f) {
      setFile(f);
      setResult(null);
      setUploadError(null);
    }
  }

  async function handleUploadShort() {
    if (!shortFile || !canEdit || shortUploading) return;
    setShortUploading(true);
    setShortError(null);
    setShortResult(null);
    try {
      const r = await uploadShortCsv(shortFile, shortType);
      setShortResult(r);
      setShortResultFile(shortFile.name);
      setShortFile(null);
      setLogsLoading(true);
      void loadLogs();
    } catch (e) {
      setShortError(e instanceof Error ? e.message : "アップロードに失敗しました");
    } finally {
      setShortUploading(false);
    }
  }

  function pickShortFile(f: File | undefined | null) {
    if (f) {
      setShortFile(f);
      setShortResult(null);
      setShortError(null);
    }
  }

  async function handleUploadMonthlyVideo() {
    if (!videoFile || !videoYearMonth || !canEdit || videoUploading) return;
    setVideoUploading(true);
    setVideoError(null);
    setVideoResult(null);
    try {
      const r = await uploadMonthlyVideoCsv(videoFile, videoYearMonth);
      setVideoResult(r);
      setVideoResultFile(videoFile.name);
      setVideoFile(null);
      setLogsLoading(true);
      void loadLogs();
    } catch (e) {
      setVideoError(e instanceof Error ? e.message : "アップロードに失敗しました");
    } finally {
      setVideoUploading(false);
    }
  }

  function pickVideoFile(f: File | undefined | null) {
    if (f) {
      setVideoFile(f);
      setVideoResult(null);
      setVideoError(null);
    }
  }

  function addMonthlyFiles(files: FileList | File[] | null | undefined) {
    if (!files) return;
    const arr = Array.from(files).filter(
      (f) =>
        f.name.toLowerCase().endsWith(".csv") ||
        f.type === "text/csv" ||
        f.type === "application/vnd.ms-excel",
    );
    if (arr.length === 0) return;
    setMonthlySummary(null);
    setMonthlyRows((rows) => {
      const next = [...rows];
      for (const f of arr) {
        monthlyRowIdRef.current += 1;
        const g = guessMonthlyFromName(f.name, monthOptions, monthlyDefaultYM);
        next.push({
          id: `mr${monthlyRowIdRef.current}`,
          fileName: f.name,
          file: f,
          yearMonth: g.yearMonth,
          kind: g.kind,
          segment: g.segment,
          status: "idle",
          message: null,
        });
      }
      return next;
    });
  }

  function updateMonthlyRow(id: string, patch: Partial<MonthlyRow>) {
    setMonthlyRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeMonthlyRow(id: string) {
    setMonthlyRows((rows) => rows.filter((r) => r.id !== id));
  }

  function clearMonthlyRows() {
    setMonthlyRows([]);
    setMonthlySummary(null);
    setMonthlyProgress(null);
  }

  async function handleUploadMonthlyBatch() {
    if (!canEdit || monthlyBatchRunning) return;
    // 未成功(idle/error)の行のみ処理 → 失敗後の再実行で成功分を二重投入しない
    const targets = monthlyRows.filter((r) => r.status !== "success");
    if (targets.length === 0) return;

    setMonthlyBatchRunning(true);
    setMonthlySummary(null);
    setMonthlyProgress({ current: 0, total: targets.length });

    let success = 0;
    let fail = 0;
    for (let i = 0; i < targets.length; i += 1) {
      const row = targets[i];
      setMonthlyProgress({ current: i + 1, total: targets.length });
      updateMonthlyRow(row.id, { status: "uploading", message: null });

      if (!row.yearMonth) {
        fail += 1;
        updateMonthlyRow(row.id, { status: "error", message: "対象月を選択してください" });
        continue;
      }
      try {
        const r = await uploadMonthlyCsv(row.file, row.yearMonth, row.segment, row.kind);
        success += 1;
        updateMonthlyRow(row.id, {
          status: "success",
          message: `${formatYearMonthLabel(r.year_month)}・${MONTHLY_KIND_LABEL[r.kind]}・${
            MONTHLY_SEGMENT_LABEL[r.segment]
          } 保存 ${formatNumber(r.rows_written)} 行${r.replaced ? "（置換）" : ""}`,
        });
      } catch (e) {
        fail += 1;
        updateMonthlyRow(row.id, {
          status: "error",
          message: e instanceof Error ? e.message : "アップロードに失敗しました",
        });
      }
    }

    setMonthlySummary({ success, fail });
    setMonthlyProgress(null);
    setMonthlyBatchRunning(false);
    setLogsLoading(true);
    void loadLogs();
  }

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">データ取り込み</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          YouTube Studio のCSVをアップロードして番組データへ投入します（同接xlsxは次段階で対応）
        </p>
      </header>

      {/* アップロード */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">CSVアップロード</CardTitle>
          {authRequired === true && !canEdit && (
            <button
              type="button"
              onClick={() => setLoginOpen(true)}
              className="rounded-md bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
            >
              ログイン
            </button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 種別選択 */}
          <div className="flex flex-wrap gap-3">
            {TYPE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${
                  type === opt.value ? "border-blue-500 bg-blue-50/50" : "hover:bg-muted/40"
                }`}
              >
                <input
                  type="radio"
                  name="ingest-type"
                  checked={type === opt.value}
                  onChange={() => setType(opt.value)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">{opt.label}</span>
                  <span className="block text-xs text-muted-foreground">{opt.hint}</span>
                </span>
              </label>
            ))}
          </div>

          {/* ファイル選択（クリック or ドラッグ&ドロップ） */}
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              pickFile(e.dataTransfer.files?.[0]);
            }}
            className={`flex h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-sm ${
              dragOver ? "border-blue-400 bg-blue-50/50" : "border-muted-foreground/25 hover:bg-muted/30"
            }`}
          >
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                pickFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {file ? (
              <>
                <span className="font-medium">{file.name}</span>
                <span className="text-xs text-muted-foreground">
                  {formatNumber(file.size)} バイト — クリックで選び直し
                </span>
              </>
            ) : (
              <>
                <span>CSVファイルをドロップ、またはクリックして選択</span>
                <span className="text-xs text-muted-foreground">.csv（UTF-8 / Shift_JIS 両対応）</span>
              </>
            )}
          </label>

          {/* 実行 */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void handleUpload()}
              disabled={!file || !canEdit || uploading}
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {uploading ? "投入中…" : "取り込み実行"}
            </button>
            {!canEdit && probed && (
              <span className="text-xs text-muted-foreground">投入にはログインが必要です</span>
            )}
            <span className="text-xs text-muted-foreground">
              ファイルは投入処理にのみ使用し、サーバには保存されません。同じファイルを再投入しても重複しません。
            </span>
          </div>

          {/* 結果 / エラー */}
          {uploadError && (
            <div className="rounded-md border border-red-200 bg-red-50/50 p-3 text-sm text-red-600">
              {uploadError}
            </div>
          )}
          {result && (
            <div className="rounded-md border border-green-200 bg-green-50/50 p-3 text-sm">
              <div className="font-medium text-green-800">取り込み完了{resultFile ? `: ${resultFile}` : ""}</div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>投入 {formatNumber(result.inserted)} 件</span>
                <span>スキップ(重複等) {formatNumber(result.skipped)} 件</span>
                <span>紐づいた番組 {formatNumber(result.matched_videos)} 本</span>
                <span className={result.unmatched > 0 ? "text-amber-700" : ""}>
                  未マッチ {formatNumber(result.unmatched)} 行
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ショートCSVアップロード（通常CSVとは独立） */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">ショートCSVアップロード</CardTitle>
          {authRequired === true && !canEdit && (
            <button
              type="button"
              onClick={() => setLoginOpen(true)}
              className="rounded-md bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
            >
              ログイン
            </button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            ショート専用CSV。未登録の動画IDは新規ショート（content_type=short）として作成し、既存IDには数値のみ付与します。
          </p>

          {/* 種別選択 */}
          <div className="flex flex-wrap gap-3">
            {SHORT_TYPE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${
                  shortType === opt.value ? "border-blue-500 bg-blue-50/50" : "hover:bg-muted/40"
                }`}
              >
                <input
                  type="radio"
                  name="short-ingest-type"
                  checked={shortType === opt.value}
                  onChange={() => setShortType(opt.value)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">{opt.label}</span>
                  <span className="block text-xs text-muted-foreground">{opt.hint}</span>
                </span>
              </label>
            ))}
          </div>

          {/* ファイル選択 */}
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setShortDragOver(true);
            }}
            onDragLeave={() => setShortDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setShortDragOver(false);
              pickShortFile(e.dataTransfer.files?.[0]);
            }}
            className={`flex h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-sm ${
              shortDragOver ? "border-blue-400 bg-blue-50/50" : "border-muted-foreground/25 hover:bg-muted/30"
            }`}
          >
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                pickShortFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {shortFile ? (
              <>
                <span className="font-medium">{shortFile.name}</span>
                <span className="text-xs text-muted-foreground">
                  {formatNumber(shortFile.size)} バイト — クリックで選び直し
                </span>
              </>
            ) : (
              <>
                <span>ショートCSVをドロップ、またはクリックして選択</span>
                <span className="text-xs text-muted-foreground">.csv（UTF-8 / Shift_JIS 両対応）</span>
              </>
            )}
          </label>

          {/* 実行 */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void handleUploadShort()}
              disabled={!shortFile || !canEdit || shortUploading}
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {shortUploading ? "投入中…" : "ショート取り込み実行"}
            </button>
            {!canEdit && probed && (
              <span className="text-xs text-muted-foreground">投入にはログインが必要です</span>
            )}
          </div>

          {/* 結果 / エラー */}
          {shortError && (
            <div className="rounded-md border border-red-200 bg-red-50/50 p-3 text-sm text-red-600">
              {shortError}
            </div>
          )}
          {shortResult && (
            <div className="rounded-md border border-green-200 bg-green-50/50 p-3 text-sm">
              <div className="font-medium text-green-800">取り込み完了{shortResultFile ? `: ${shortResultFile}` : ""}</div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>新規作成 {formatNumber(shortResult.created ?? 0)} 本</span>
                <span>投入 {formatNumber(shortResult.inserted)} 件</span>
                <span>スキップ(重複等) {formatNumber(shortResult.skipped)} 件</span>
                <span>対象ショート {formatNumber(shortResult.matched_videos)} 本</span>
                <span className={shortResult.unmatched > 0 ? "text-amber-700" : ""}>
                  未処理 {formatNumber(shortResult.unmatched)} 行
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 月次データCSVアップロード（通常/ショートとは独立） */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">月次データCSVアップロード</CardTitle>
          {authRequired === true && !canEdit && (
            <button
              type="button"
              onClick={() => setLoginOpen(true)}
              className="rounded-md bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
            >
              ログイン
            </button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            チャンネル全体の月次データを複数まとめて投入できます。ファイルごとに対象月・種別・セグメントを指定し、「まとめて取り込み」で順番に登録します。同じ月・種別・セグメントを入れ直すと最新値で置換されます。
          </p>

          {/* ファイル選択（複数可・ドラッグ&ドロップ） */}
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setMonthlyDragOver(true);
            }}
            onDragLeave={() => setMonthlyDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setMonthlyDragOver(false);
              addMonthlyFiles(e.dataTransfer.files);
            }}
            className={`flex h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-sm ${
              monthlyDragOver ? "border-blue-400 bg-blue-50/50" : "border-muted-foreground/25 hover:bg-muted/30"
            }`}
          >
            <input
              type="file"
              accept=".csv,text/csv"
              multiple
              className="hidden"
              onChange={(e) => {
                addMonthlyFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <span>月次CSVをドロップ、またはクリックして選択（複数可）</span>
            <span className="text-xs text-muted-foreground">.csv（UTF-8 / Shift_JIS 両対応）</span>
          </label>

          {/* ファイルごとの設定リスト */}
          {monthlyRows.length > 0 && (
            <div className="space-y-2">
              {monthlyRows.map((row) => (
                <div key={row.id} className="space-y-2 rounded-lg border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium" title={row.fileName}>
                      {row.fileName}
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      {row.status === "uploading" && (
                        <span className="text-xs text-blue-600">処理中…</span>
                      )}
                      {row.status === "success" && (
                        <span className="rounded bg-green-50 px-1.5 py-0.5 text-xs text-green-700">✓ 成功</span>
                      )}
                      {row.status === "error" && (
                        <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-600">✗ 失敗</span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeMonthlyRow(row.id)}
                        disabled={monthlyBatchRunning}
                        className="rounded border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-50"
                      >
                        削除
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {/* 対象月 */}
                    <select
                      aria-label="対象月"
                      value={row.yearMonth}
                      onChange={(e) => updateMonthlyRow(row.id, { yearMonth: e.target.value })}
                      disabled={monthlyBatchRunning}
                      className="rounded-md border bg-background px-2 py-1 text-sm disabled:opacity-50"
                    >
                      {monthOptions.length === 0 && <option value="">—</option>}
                      {monthOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>

                    {/* 種別 */}
                    <select
                      aria-label="種別"
                      value={row.kind}
                      onChange={(e) =>
                        updateMonthlyRow(row.id, { kind: e.target.value as MonthlyKind })
                      }
                      disabled={monthlyBatchRunning}
                      className="rounded-md border bg-background px-2 py-1 text-sm disabled:opacity-50"
                    >
                      {MONTHLY_KIND_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>

                    {/* セグメント */}
                    <select
                      aria-label="セグメント"
                      value={row.segment}
                      onChange={(e) =>
                        updateMonthlyRow(row.id, { segment: e.target.value as MonthlySegment })
                      }
                      disabled={monthlyBatchRunning}
                      className="rounded-md border bg-background px-2 py-1 text-sm disabled:opacity-50"
                    >
                      {MONTHLY_SEGMENT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {row.message && (
                    <div
                      className={`text-xs ${
                        row.status === "error" ? "text-red-600" : "text-muted-foreground"
                      }`}
                    >
                      {row.message}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 実行 */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleUploadMonthlyBatch()}
              disabled={
                !canEdit ||
                monthlyBatchRunning ||
                monthlyRows.length === 0 ||
                monthlyRows.every((r) => r.status === "success")
              }
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {monthlyBatchRunning ? "取り込み中…" : "まとめて取り込み"}
            </button>
            {monthlyRows.length > 0 && (
              <button
                type="button"
                onClick={clearMonthlyRows}
                disabled={monthlyBatchRunning}
                className="rounded border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
              >
                クリア
              </button>
            )}
            {monthlyProgress && (
              <span className="text-xs text-muted-foreground">
                {monthlyProgress.current}/{monthlyProgress.total} 処理中…
              </span>
            )}
            {!canEdit && probed && (
              <span className="text-xs text-muted-foreground">投入にはログインが必要です</span>
            )}
          </div>

          {/* サマリ */}
          {monthlySummary && (
            <div
              className={`rounded-md border p-3 text-sm ${
                monthlySummary.fail > 0
                  ? "border-amber-200 bg-amber-50/50 text-amber-800"
                  : "border-green-200 bg-green-50/50 text-green-800"
              }`}
            >
              成功 {formatNumber(monthlySummary.success)} 件・失敗 {formatNumber(monthlySummary.fail)} 件
              {monthlySummary.fail > 0 && "（失敗した行は内容を直して「まとめて取り込み」で再実行できます）"}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 月次・動画別CSVアップロード（WebCM切り出し基盤。他の投入口とは独立） */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">月次・動画別CSVアップロード</CardTitle>
          {authRequired === true && !canEdit && (
            <button
              type="button"
              onClick={() => setLoginOpen(true)}
              className="rounded-md bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
            >
              ログイン
            </button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            動画別CSV（YouTube Studio のコンテンツ別エクスポート）を「対象月 × 動画」で投入します。タイトルに「WebCM」を含む動画は広告(is_ad)として記録します。合計行・コンテンツID空の行は取り込みません。同じ月・同じ動画を入れ直すと最新値で置換されます。
          </p>

          {/* 対象月 */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground" htmlFor="video-month">
              対象月
            </label>
            <select
              id="video-month"
              value={videoYearMonth}
              onChange={(e) => setVideoYearMonth(e.target.value)}
              disabled={videoUploading}
              className="rounded-md border bg-background px-2 py-1 text-sm disabled:opacity-50"
            >
              {monthOptions.length === 0 && <option value="">—</option>}
              {monthOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* ファイル選択 */}
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setVideoDragOver(true);
            }}
            onDragLeave={() => setVideoDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setVideoDragOver(false);
              pickVideoFile(e.dataTransfer.files?.[0]);
            }}
            className={`flex h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-sm ${
              videoDragOver ? "border-blue-400 bg-blue-50/50" : "border-muted-foreground/25 hover:bg-muted/30"
            }`}
          >
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                pickVideoFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {videoFile ? (
              <>
                <span className="font-medium">{videoFile.name}</span>
                <span className="text-xs text-muted-foreground">
                  {formatNumber(videoFile.size)} バイト — クリックで選び直し
                </span>
              </>
            ) : (
              <>
                <span>動画別CSVをドロップ、またはクリックして選択</span>
                <span className="text-xs text-muted-foreground">.csv（UTF-8 / Shift_JIS 両対応）</span>
              </>
            )}
          </label>

          {/* 実行 */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void handleUploadMonthlyVideo()}
              disabled={!videoFile || !videoYearMonth || !canEdit || videoUploading}
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {videoUploading ? "投入中…" : "動画別取り込み実行"}
            </button>
            {!canEdit && probed && (
              <span className="text-xs text-muted-foreground">投入にはログインが必要です</span>
            )}
          </div>

          {/* 結果 / エラー */}
          {videoError && (
            <div className="rounded-md border border-red-200 bg-red-50/50 p-3 text-sm text-red-600">
              {videoError}
            </div>
          )}
          {videoResult && (
            <div className="rounded-md border border-green-200 bg-green-50/50 p-3 text-sm">
              <div className="font-medium text-green-800">
                取り込み完了{videoResultFile ? `: ${videoResultFile}` : ""}（{formatYearMonthLabel(videoResult.year_month)}）
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>保存 {formatNumber(videoResult.rows_written)} 本</span>
                <span className={videoResult.ad_rows > 0 ? "text-blue-700" : ""}>
                  WebCM該当 {formatNumber(videoResult.ad_rows)} 本
                </span>
                <span>スキップ(合計行/ID空) {formatNumber(videoResult.skipped)} 行</span>
                {videoResult.replaced && <span>（同月同動画は置換）</span>}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 取り込み履歴 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">取り込み履歴</CardTitle>
          <button
            type="button"
            onClick={() => {
              setLogsLoading(true);
              void loadLogs();
            }}
            disabled={logsLoading}
            className="rounded border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-50"
          >
            更新
          </button>
        </CardHeader>
        <CardContent>
          {logsError ? (
            <div className="py-6 text-center text-sm text-muted-foreground">{logsError}</div>
          ) : logsLoading && logs.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">読み込み中…</div>
          ) : logs.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">取り込み履歴はまだありません</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-2 py-2 font-medium">日時</th>
                    <th className="px-2 py-2 font-medium">ファイル名</th>
                    <th className="px-2 py-2 font-medium">種別</th>
                    <th className="px-2 py-2 text-right font-medium">処理件数</th>
                    <th className="px-2 py-2 text-right font-medium">失敗</th>
                    <th className="px-2 py-2 font-medium">状態</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => {
                    const at = l.completed_at ?? l.started_at;
                    return (
                      <tr key={l.id} className="border-b last:border-0">
                        <td className="px-2 py-2 whitespace-nowrap tabular-nums">
                          {at ? formatDateTime(new Date(at)) : "—"}
                        </td>
                        <td className="max-w-[260px] truncate px-2 py-2" title={l.file_name ?? undefined}>
                          {l.file_name ?? "—"}
                        </td>
                        <td className="px-2 py-2">{l.source_type}</td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {formatNumber(l.records_processed)}
                        </td>
                        <td className={`px-2 py-2 text-right tabular-nums ${l.records_failed > 0 ? "text-amber-700" : ""}`}>
                          {formatNumber(l.records_failed)}
                        </td>
                        <td className="px-2 py-2">
                          <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_BADGE[l.status] ?? "bg-muted text-muted-foreground"}`}>
                            {l.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <LoginDialog open={loginOpen} onClose={() => setLoginOpen(false)} />
    </main>
  );
}
