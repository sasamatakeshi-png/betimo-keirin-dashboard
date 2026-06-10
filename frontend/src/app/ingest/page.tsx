"use client";

// データ取り込み: 全期間CSV / 90日CSV をアップロードして metric_values へ投入し、
// 取り込み履歴(ingestion_logs)を表示する。投入は要ログイン（編集権限）。

import { useCallback, useEffect, useState } from "react";

import { LoginDialog } from "@/components/auth/login-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ApiError,
  getIngestionLogs,
  uploadIngestionCsv,
  uploadMonthlyCsv,
  uploadShortCsv,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime, formatNumber } from "@/lib/format";
import type {
  IngestionLog,
  IngestType,
  MonthlyKind,
  MonthlySegment,
  MonthlyUploadResult,
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

  // 月次データCSV（通常/ショートとは独立した投入口）
  // 対象月リストは現在時刻から算出（lazy初期化。既定は最新月）。
  const [monthOptions] = useState<{ value: string; label: string }[]>(() =>
    buildMonthOptions(new Date()),
  );
  const [monthlyYearMonth, setMonthlyYearMonth] = useState<string>(
    () => monthOptions[0]?.value ?? "",
  );
  const [monthlyKind, setMonthlyKind] = useState<MonthlyKind>("metrics");
  const [monthlySegment, setMonthlySegment] = useState<MonthlySegment>("all");
  const [monthlyFile, setMonthlyFile] = useState<File | null>(null);
  const [monthlyDragOver, setMonthlyDragOver] = useState(false);
  const [monthlyUploading, setMonthlyUploading] = useState(false);
  const [monthlyResult, setMonthlyResult] = useState<MonthlyUploadResult | null>(null);
  const [monthlyResultFile, setMonthlyResultFile] = useState<string | null>(null);
  const [monthlyError, setMonthlyError] = useState<string | null>(null);

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

  async function handleUploadMonthly() {
    if (!monthlyFile || !monthlyYearMonth || !canEdit || monthlyUploading) return;
    setMonthlyUploading(true);
    setMonthlyError(null);
    setMonthlyResult(null);
    try {
      const r = await uploadMonthlyCsv(
        monthlyFile,
        monthlyYearMonth,
        monthlySegment,
        monthlyKind,
      );
      setMonthlyResult(r);
      setMonthlyResultFile(monthlyFile.name);
      setMonthlyFile(null);
      setLogsLoading(true);
      void loadLogs();
    } catch (e) {
      setMonthlyError(e instanceof Error ? e.message : "アップロードに失敗しました");
    } finally {
      setMonthlyUploading(false);
    }
  }

  function pickMonthlyFile(f: File | undefined | null) {
    if (f) {
      setMonthlyFile(f);
      setMonthlyResult(null);
      setMonthlyError(null);
    }
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
            チャンネル全体の月次データ。対象月・種別・セグメントを選んで投入します。同じ月・種別・セグメントを入れ直すと最新値で置換されます。
          </p>

          {/* 対象月・種別・セグメント */}
          <div className="grid gap-4 sm:grid-cols-2">
            {/* 対象月 */}
            <div className="space-y-1">
              <label htmlFor="monthly-year-month" className="block text-xs font-medium text-muted-foreground">
                対象月
              </label>
              <select
                id="monthly-year-month"
                value={monthlyYearMonth}
                onChange={(e) => setMonthlyYearMonth(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-1.5 text-sm"
              >
                {monthOptions.length === 0 && <option value="">—</option>}
                {monthOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* セグメント */}
            <div className="space-y-1">
              <span className="block text-xs font-medium text-muted-foreground">セグメント</span>
              <div className="flex flex-wrap gap-2">
                {MONTHLY_SEGMENT_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm ${
                      monthlySegment === opt.value ? "border-blue-500 bg-blue-50/50" : "hover:bg-muted/40"
                    }`}
                  >
                    <input
                      type="radio"
                      name="monthly-segment"
                      checked={monthlySegment === opt.value}
                      onChange={() => setMonthlySegment(opt.value)}
                    />
                    <span className="font-medium">{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* 種別 */}
          <div className="flex flex-wrap gap-3">
            {MONTHLY_KIND_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${
                  monthlyKind === opt.value ? "border-blue-500 bg-blue-50/50" : "hover:bg-muted/40"
                }`}
              >
                <input
                  type="radio"
                  name="monthly-kind"
                  checked={monthlyKind === opt.value}
                  onChange={() => setMonthlyKind(opt.value)}
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
              setMonthlyDragOver(true);
            }}
            onDragLeave={() => setMonthlyDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setMonthlyDragOver(false);
              pickMonthlyFile(e.dataTransfer.files?.[0]);
            }}
            className={`flex h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-sm ${
              monthlyDragOver ? "border-blue-400 bg-blue-50/50" : "border-muted-foreground/25 hover:bg-muted/30"
            }`}
          >
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                pickMonthlyFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {monthlyFile ? (
              <>
                <span className="font-medium">{monthlyFile.name}</span>
                <span className="text-xs text-muted-foreground">
                  {formatNumber(monthlyFile.size)} バイト — クリックで選び直し
                </span>
              </>
            ) : (
              <>
                <span>月次CSVをドロップ、またはクリックして選択</span>
                <span className="text-xs text-muted-foreground">.csv（UTF-8 / Shift_JIS 両対応）</span>
              </>
            )}
          </label>

          {/* 実行 */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void handleUploadMonthly()}
              disabled={!monthlyFile || !monthlyYearMonth || !canEdit || monthlyUploading}
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {monthlyUploading ? "投入中…" : "月次取り込み実行"}
            </button>
            {!canEdit && probed && (
              <span className="text-xs text-muted-foreground">投入にはログインが必要です</span>
            )}
          </div>

          {/* 結果 / エラー */}
          {monthlyError && (
            <div className="rounded-md border border-red-200 bg-red-50/50 p-3 text-sm text-red-600">
              {monthlyError}
            </div>
          )}
          {monthlyResult && (
            <div className="rounded-md border border-green-200 bg-green-50/50 p-3 text-sm">
              <div className="font-medium text-green-800">
                {formatYearMonthLabel(monthlyResult.year_month)}・
                {MONTHLY_KIND_LABEL[monthlyResult.kind]}・
                {MONTHLY_SEGMENT_LABEL[monthlyResult.segment]} を取り込みました
                {monthlyResult.replaced ? "（置換）" : ""}
                {monthlyResultFile ? `: ${monthlyResultFile}` : ""}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>保存 {formatNumber(monthlyResult.rows_written)} 行</span>
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
