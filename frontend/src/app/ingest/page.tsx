"use client";

// データ取り込み: 全期間CSV / 90日CSV をアップロードして metric_values へ投入し、
// 取り込み履歴(ingestion_logs)を表示する。投入は要ログイン（編集権限）。

import { useCallback, useEffect, useRef, useState } from "react";

import { LoginDialog } from "@/components/auth/login-dialog";
import { Modal } from "@/components/modal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ApiError,
  commitStudioCcu,
  deleteMonthlyData,
  getDeletePreview,
  getIngestionLogs,
  previewStudioCcu,
  uploadConcurrentXlsx,
  uploadIngestionCsv,
  uploadMonthlyCsv,
  uploadMonthlyVideoCsv,
  uploadShortCsv,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import {
  NAMING_RULES,
  guessMonthly,
  guessNormalType,
  guessShortType,
  guessYearMonth,
} from "@/lib/ingest-guess";
import type {
  ConcurrentUploadResult,
  DeletableKind,
  DeletePreviewResult,
  DeleteResult,
  IngestionLog,
  IngestType,
  MonthlyKind,
  MonthlySegment,
  MonthlyVideoUploadResult,
  ShortIngestType,
  StudioCcuCommitResult,
  StudioCcuPreviewResult,
  UploadResult,
} from "@/types/ingestion";

const TYPE_OPTIONS: { value: IngestType; label: string; hint: string }[] = [
  { value: "zenkikan_csv", label: "全期間CSV", hint: "imp / 再生数 / 登録数 / 平均視聴時間 / 平均再生率" },
  { value: "90d_csv", label: "90日CSV", hint: "UU数 / 新規・リピーター / リピーター比率" },
  { value: "live_views_csv", label: "ライブ視聴CSV", hint: "「全期間データ（ライブ視聴）.csv」の視聴回数 → ライブ視聴(live_views)" },
  { value: "archive_views_csv", label: "アーカイブ視聴CSV", hint: "「全期間データ（アーカイブ視聴）.csv」の視聴回数 → アーカイブ視聴(archive_views)" },
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
  // ファイル名から推測できた項目（手動変更の不一致強調に使う。①の警告と連動）
  inferred: { yearMonth: boolean; kind: boolean; segment: boolean };
  status: MonthlyRowStatus;
  message: string | null;
}

// 同接xlsx・複数ファイル投入の1行分の状態
type ConcRowStatus = "idle" | "uploading" | "success" | "error";
interface ConcRow {
  id: string;
  fileName: string;
  file: File;
  status: ConcRowStatus;
  message: string | null;
}

// 削除UI（取り込みの修正）。種別の表示ラベルとテーブル名。
const DELETABLE_KIND_OPTIONS: { value: DeletableKind; label: string; table: string; hasSegment: boolean }[] = [
  { value: "monthly_metrics", label: "月次・数値", table: "monthly_channel_metrics", hasSegment: true },
  { value: "monthly_demographics", label: "月次・性別年齢", table: "monthly_demographics", hasSegment: true },
  { value: "monthly_video", label: "月次・動画別", table: "monthly_video_metrics", hasSegment: false },
];

// 取り込みログ(source_type)から「取り消し」削除対象を導出する。
// 月次系のみ正確に紐付け可能。それ以外（通常/ショートCSV、削除ログ）は null＝取り消し非対応。
function logToDeleteTarget(
  log: IngestionLog,
): { kind: DeletableKind; yearMonth: string; segment: MonthlySegment | null } | null {
  const e = (log.error_log ?? {}) as Record<string, unknown>;
  // 削除の監査ログ（取り込みと同じ *_csv source_type で記録）には取り消しを出さない。
  if (e.action === "delete") return null;
  const ym = typeof e.year_month === "string" ? e.year_month : null;
  const seg =
    e.segment === "all" || e.segment === "live" || e.segment === "short"
      ? (e.segment as MonthlySegment)
      : null;
  if (!ym) return null;
  switch (log.source_type) {
    case "monthly_metrics_csv":
      return seg ? { kind: "monthly_metrics", yearMonth: ym, segment: seg } : null;
    case "monthly_demographics_csv":
      return seg ? { kind: "monthly_demographics", yearMonth: ym, segment: seg } : null;
    case "monthly_video_csv":
      return { kind: "monthly_video", yearMonth: ym, segment: null };
    default:
      return null; // zenkikan/90d/short/delete_* は取り消し非対応
  }
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

  // 同時接続数xlsx（複数ファイルをまとめて順次投入。他の投入口とは独立）
  const [concRows, setConcRows] = useState<ConcRow[]>([]);
  const [concDragOver, setConcDragOver] = useState(false);
  const [concBatchRunning, setConcBatchRunning] = useState(false);
  const [concProgress, setConcProgress] = useState<{ current: number; total: number } | null>(
    null,
  );
  const [concSummary, setConcSummary] = useState<{ success: number; fail: number } | null>(null);
  const concRowIdRef = useRef(0);

  // Studio自社同接CSV（2段階: アップロード→推測表示→確認→保存。他の投入口とは独立）
  const [studioFile, setStudioFile] = useState<File | null>(null);
  const [studioDragOver, setStudioDragOver] = useState(false);
  const [studioBusy, setStudioBusy] = useState(false); // preview or commit 実行中
  const [studioPreview, setStudioPreview] = useState<StudioCcuPreviewResult | null>(null);
  const [studioSelectedId, setStudioSelectedId] = useState<string>("");
  const [studioResult, setStudioResult] = useState<StudioCcuCommitResult | null>(null);
  const [studioError, setStudioError] = useState<string | null>(null);

  const [logs, setLogs] = useState<IngestionLog[]>([]);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logsLoading, setLogsLoading] = useState(true);

  // ③ 削除（取り込みの修正）。(b)月指定フォームの選択状態。
  const [delKind, setDelKind] = useState<DeletableKind>("monthly_video");
  const [delYM, setDelYM] = useState<string>(monthlyDefaultYM);
  const [delSegment, setDelSegment] = useState<MonthlySegment>("all");
  // 二段階確認: プレビュー取得 → モーダルで確認 → 実行。
  const [delTarget, setDelTarget] = useState<{
    kind: DeletableKind;
    yearMonth: string;
    segment: MonthlySegment | null;
  } | null>(null);
  const [delPreview, setDelPreview] = useState<DeletePreviewResult | null>(null);
  const [delModalOpen, setDelModalOpen] = useState(false);
  const [delBusy, setDelBusy] = useState(false); // プレビュー取得 or 削除実行中
  const [delConfirmChecked, setDelConfirmChecked] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);
  const [delResult, setDelResult] = useState<DeleteResult | null>(null);

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
    // ① 不一致警告: ファイル名から種別を推測でき、選択中と食い違うなら確認。
    const guessed = guessNormalType(file.name);
    if (guessed && guessed !== type) {
      const gl = TYPE_OPTIONS.find((o) => o.value === guessed)?.label ?? guessed;
      const cl = TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
      if (
        !window.confirm(
          `ファイル名は「${gl}」のようですが、種別は「${cl}」が選ばれています。続行しますか？`,
        )
      )
        return;
    }
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
      // ② 自動判別: ファイル名から種別が分かれば選択を合わせる。
      const guessed = guessNormalType(f.name);
      if (guessed) setType(guessed);
    }
  }

  async function handleUploadShort() {
    if (!shortFile || !canEdit || shortUploading) return;
    // ① 不一致警告
    const guessed = guessShortType(shortFile.name);
    if (guessed && guessed !== shortType) {
      const gl = SHORT_TYPE_OPTIONS.find((o) => o.value === guessed)?.label ?? guessed;
      const cl = SHORT_TYPE_OPTIONS.find((o) => o.value === shortType)?.label ?? shortType;
      if (
        !window.confirm(
          `ファイル名は「${gl}」のようですが、種別は「${cl}」が選ばれています。続行しますか？`,
        )
      )
        return;
    }
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
      // ② 自動判別
      const guessed = guessShortType(f.name);
      if (guessed) setShortType(guessed);
    }
  }

  async function handleUploadMonthlyVideo() {
    if (!videoFile || !videoYearMonth || !canEdit || videoUploading) return;
    // ① 不一致警告: ファイル名の月が選択中の対象月と食い違うなら確認。
    const guessedYM = guessYearMonth(videoFile.name, monthOptions.map((o) => o.value));
    if (guessedYM && guessedYM !== videoYearMonth) {
      if (
        !window.confirm(
          `ファイル名は「${formatYearMonthLabel(guessedYM)}」ですが、対象月は「${formatYearMonthLabel(
            videoYearMonth,
          )}」が選ばれています。続行しますか？`,
        )
      )
        return;
    }
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
      // ② 自動判別: ファイル名の月を対象月にセット。
      const guessedYM = guessYearMonth(f.name, monthOptions.map((o) => o.value));
      if (guessedYM) setVideoYearMonth(guessedYM);
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
    const monthValues = monthOptions.map((o) => o.value);
    setMonthlyRows((rows) => {
      const next = [...rows];
      for (const f of arr) {
        monthlyRowIdRef.current += 1;
        const g = guessMonthly(f.name, monthValues, monthlyDefaultYM);
        next.push({
          id: `mr${monthlyRowIdRef.current}`,
          fileName: f.name,
          file: f,
          yearMonth: g.yearMonth,
          kind: g.kind,
          segment: g.segment,
          inferred: g.inferred,
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

  // ① 行ごとの不一致判定: ファイル名から推測できた項目が、現在の設定と食い違うか。
  const monthValues = monthOptions.map((o) => o.value);
  function rowFieldMismatch(row: MonthlyRow): {
    yearMonth: boolean;
    kind: boolean;
    segment: boolean;
  } {
    const g = guessMonthly(row.fileName, monthValues, monthlyDefaultYM);
    return {
      yearMonth: g.inferred.yearMonth && g.yearMonth !== row.yearMonth,
      kind: g.inferred.kind && g.kind !== row.kind,
      segment: g.inferred.segment && g.segment !== row.segment,
    };
  }
  function isRowMismatched(row: MonthlyRow): boolean {
    const m = rowFieldMismatch(row);
    return m.yearMonth || m.kind || m.segment;
  }

  async function handleUploadMonthlyBatch() {
    if (!canEdit || monthlyBatchRunning) return;
    // 未成功(idle/error)の行のみ処理 → 失敗後の再実行で成功分を二重投入しない
    const targets = monthlyRows.filter((r) => r.status !== "success");
    if (targets.length === 0) return;

    // ① 不一致警告: 自動判別と異なる手動変更がある行をまとめて確認する。
    const mismatched = targets.filter((r) => isRowMismatched(r));
    if (mismatched.length > 0) {
      const lines = mismatched
        .map(
          (r) =>
            `・${r.fileName} → ${formatYearMonthLabel(r.yearMonth)}・${MONTHLY_KIND_LABEL[r.kind]}・${MONTHLY_SEGMENT_LABEL[r.segment]}`,
        )
        .join("\n");
      if (
        !window.confirm(
          `次の ${mismatched.length} 件はファイル名からの自動判別と設定が食い違っています。この設定で取り込みますか？\n\n${lines}`,
        )
      )
        return;
    }

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

  // --- 同接xlsx バッチ投入 ---
  function addConcFiles(files: FileList | File[] | null | undefined) {
    if (!files) return;
    const arr = Array.from(files).filter((f) => f.name.toLowerCase().endsWith(".xlsx"));
    if (arr.length === 0) return;
    setConcSummary(null);
    setConcRows((rows) => {
      const next = [...rows];
      for (const f of arr) {
        concRowIdRef.current += 1;
        next.push({
          id: `cc${concRowIdRef.current}`,
          fileName: f.name,
          file: f,
          status: "idle",
          message: null,
        });
      }
      return next;
    });
  }

  function updateConcRow(id: string, patch: Partial<ConcRow>) {
    setConcRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeConcRow(id: string) {
    setConcRows((rows) => rows.filter((r) => r.id !== id));
  }

  function clearConcRows() {
    setConcRows([]);
    setConcSummary(null);
    setConcProgress(null);
  }

  async function handleUploadConcBatch() {
    if (!canEdit || concBatchRunning) return;
    // 未成功(idle/error)の行のみ処理 → 再実行で成功分を二重投入しない
    const targets = concRows.filter((r) => r.status !== "success");
    if (targets.length === 0) return;

    setConcBatchRunning(true);
    setConcSummary(null);
    setConcProgress({ current: 0, total: targets.length });

    let success = 0;
    let fail = 0;
    for (let i = 0; i < targets.length; i += 1) {
      const row = targets[i];
      setConcProgress({ current: i + 1, total: targets.length });
      updateConcRow(row.id, { status: "uploading", message: null });
      try {
        const r: ConcurrentUploadResult = await uploadConcurrentXlsx(row.file);
        success += 1;
        const apiNote = r.used_youtube_api ? "・YouTube API使用" : "";
        updateConcRow(row.id, {
          status: "success",
          message: `対象 ${formatNumber(r.videos_total)} 本（新規 ${formatNumber(
            r.videos_created,
          )}）・投入 ${formatNumber(r.inserted_points)} 点（重複 ${formatNumber(
            r.duplicate_points,
          )}）・最大/平均 ${formatNumber(r.scalars_written)} 件・対象外 ${formatNumber(
            r.skipped_rows,
          )} 行${apiNote}`,
        });
      } catch (e) {
        fail += 1;
        updateConcRow(row.id, {
          status: "error",
          message: e instanceof Error ? e.message : "アップロードに失敗しました",
        });
      }
    }

    setConcSummary({ success, fail });
    setConcProgress(null);
    setConcBatchRunning(false);
    setLogsLoading(true);
    void loadLogs();
  }

  // --- Studio自社同接CSV: ①ファイル選択で自動プレビュー（計算＋動画推測） ---
  async function pickStudioFile(f: File | undefined | null) {
    if (!f || !canEdit) return;
    setStudioFile(f);
    setStudioResult(null);
    setStudioError(null);
    setStudioPreview(null);
    setStudioSelectedId("");
    setStudioBusy(true);
    try {
      const pv = await previewStudioCcu(f);
      setStudioPreview(pv);
      // 推測があれば既定選択、無ければ候補先頭（人が選び直せる）
      setStudioSelectedId(pv.suggested_video_id ?? pv.candidates[0]?.video_id ?? "");
    } catch (e) {
      setStudioError(e instanceof Error ? e.message : "プレビューに失敗しました");
    } finally {
      setStudioBusy(false);
    }
  }

  // --- Studio自社同接CSV: ②確認後に確定保存（max/avgをStudio値で上書き） ---
  async function handleStudioCommit() {
    if (!studioFile || !studioSelectedId || !canEdit || studioBusy) return;
    setStudioBusy(true);
    setStudioError(null);
    try {
      const r = await commitStudioCcu(studioFile, studioSelectedId);
      setStudioResult(r);
      setStudioFile(null);
      setStudioPreview(null);
      setStudioSelectedId("");
      setLogsLoading(true);
      void loadLogs();
    } catch (e) {
      setStudioError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setStudioBusy(false);
    }
  }

  // ③ 削除フロー: 第1段階＝プレビュー件数を取得してモーダルを開く（まだ消さない）。
  async function openDeleteFlow(target: {
    kind: DeletableKind;
    yearMonth: string;
    segment: MonthlySegment | null;
  }) {
    if (!canEdit || delBusy) return;
    setDelTarget(target);
    setDelPreview(null);
    setDelResult(null);
    setDelError(null);
    setDelConfirmChecked(false);
    setDelModalOpen(true);
    setDelBusy(true);
    try {
      const p = await getDeletePreview(target.kind, target.yearMonth, target.segment);
      setDelPreview(p);
    } catch (e) {
      setDelError(e instanceof Error ? e.message : "プレビューの取得に失敗しました");
    } finally {
      setDelBusy(false);
    }
  }

  // ③ 削除フロー: 第2段階＝確認後に実際の削除を実行する。
  async function confirmDelete() {
    if (!delTarget || !delConfirmChecked || delBusy) return;
    setDelBusy(true);
    setDelError(null);
    try {
      const r = await deleteMonthlyData(delTarget.kind, delTarget.yearMonth, delTarget.segment);
      setDelResult(r);
      setLogsLoading(true);
      void loadLogs();
    } catch (e) {
      setDelError(e instanceof Error ? e.message : "削除に失敗しました");
    } finally {
      setDelBusy(false);
    }
  }

  function closeDeleteModal() {
    if (delBusy) return;
    setDelModalOpen(false);
    setDelTarget(null);
    setDelPreview(null);
    setDelConfirmChecked(false);
    setDelError(null);
  }

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">データ取り込み</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          YouTube Studio のCSV・同時接続数xlsxをアップロードして番組データへ投入します
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
          <p className="text-[11px] text-muted-foreground">{NAMING_RULES.normal}</p>

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
          <p className="text-[11px] text-muted-foreground">{NAMING_RULES.short}</p>

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
          <p className="text-[11px] text-muted-foreground">{NAMING_RULES.monthly}</p>

          {/* ファイルごとの設定リスト */}
          {monthlyRows.length > 0 && (
            <div className="space-y-2">
              {monthlyRows.map((row) => {
                const mm = rowFieldMismatch(row);
                const anyMismatch = mm.yearMonth || mm.kind || mm.segment;
                const selBase = "rounded-md border bg-background px-2 py-1 text-sm disabled:opacity-50";
                const selWarn = "border-amber-400 bg-amber-50 text-amber-800";
                return (
                <div
                  key={row.id}
                  className={`space-y-2 rounded-lg border p-3 text-sm ${anyMismatch ? "border-amber-300 bg-amber-50/30" : ""}`}
                >
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
                      className={`${selBase} ${mm.yearMonth ? selWarn : ""}`}
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
                      className={`${selBase} ${mm.kind ? selWarn : ""}`}
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
                      className={`${selBase} ${mm.segment ? selWarn : ""}`}
                    >
                      {MONTHLY_SEGMENT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {anyMismatch && (
                    <div className="text-[11px] text-amber-700">
                      ⚠ ファイル名からの自動判別と設定が異なります（黄色の項目）。問題なければそのまま取り込めます。
                    </div>
                  )}

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
                );
              })}
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
          <p className="text-[11px] text-muted-foreground">{NAMING_RULES.video}</p>

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

      {/* 同時接続数xlsxアップロード（1ファイル=1レース1日。Betimo＋競合3社の同接） */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">同時接続数xlsxアップロード</CardTitle>
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
            同接監視ツールのxlsx（1ファイル＝1レース1日）を複数まとめて投入できます。「設定」シートの計測開始日時を起点に、Betimo＋競合3社（ぺーちゃんねる/オッズパーク/楽天Kドリームス）の同接時系列と最大/平均同接を保存します。対象外チャンネルの行は取り込みません。同じファイルを入れ直しても時系列は重複せず、最大/平均は最新で置換されます。
          </p>

          {/* ファイル選択（複数可・ドラッグ&ドロップ） */}
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setConcDragOver(true);
            }}
            onDragLeave={() => setConcDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setConcDragOver(false);
              addConcFiles(e.dataTransfer.files);
            }}
            className={`flex h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-sm ${
              concDragOver ? "border-blue-400 bg-blue-50/50" : "border-muted-foreground/25 hover:bg-muted/30"
            }`}
          >
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              multiple
              className="hidden"
              onChange={(e) => {
                addConcFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <span>同接xlsxをドロップ、またはクリックして選択（複数可）</span>
            <span className="text-xs text-muted-foreground">.xlsx</span>
          </label>
          <p className="text-[11px] text-muted-foreground">{NAMING_RULES.concurrent}</p>

          {/* ファイルリスト */}
          {concRows.length > 0 && (
            <div className="space-y-2">
              {concRows.map((row) => (
                <div key={row.id} className="space-y-1 rounded-lg border p-3 text-sm">
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
                        onClick={() => removeConcRow(row.id)}
                        disabled={concBatchRunning}
                        className="rounded border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-50"
                      >
                        削除
                      </button>
                    </div>
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
              onClick={() => void handleUploadConcBatch()}
              disabled={
                !canEdit ||
                concBatchRunning ||
                concRows.length === 0 ||
                concRows.every((r) => r.status === "success")
              }
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {concBatchRunning ? "取り込み中…" : "まとめて取り込み"}
            </button>
            {concRows.length > 0 && (
              <button
                type="button"
                onClick={clearConcRows}
                disabled={concBatchRunning}
                className="rounded border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
              >
                クリア
              </button>
            )}
            {concProgress && (
              <span className="text-xs text-muted-foreground">
                {concProgress.current}/{concProgress.total} 処理中…
              </span>
            )}
            {!canEdit && probed && (
              <span className="text-xs text-muted-foreground">投入にはログインが必要です</span>
            )}
          </div>

          {/* サマリ */}
          {concSummary && (
            <div
              className={`rounded-md border p-3 text-sm ${
                concSummary.fail > 0
                  ? "border-amber-200 bg-amber-50/50 text-amber-800"
                  : "border-green-200 bg-green-50/50 text-green-800"
              }`}
            >
              成功 {formatNumber(concSummary.success)} 件・失敗 {formatNumber(concSummary.fail)} 件
              {concSummary.fail > 0 && "（失敗した行はそのまま「まとめて取り込み」で再実行できます）"}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Studio自社同接CSV（自社1番組の正確な最大/平均同接で上書き。2段階＝推測→確認→保存） */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Studio自社同接CSV（最大/平均を上書き）</CardTitle>
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
            YouTube Studio の自社同接CSV（1ファイル＝自社1番組・60秒ごと）。最大＝「ライブ同時視聴者数」の最大、平均＝「平均同時視聴者数」の平均で算出し、選んだ自社動画の最大/平均同接を
            <span className="font-medium">Studio値で常に上書き</span>します（同接xlsxより正確）。アップロードすると推測した動画を表示するので、確認・修正してから保存してください。
          </p>

          {/* ファイル選択（アップロードで自動プレビュー） */}
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setStudioDragOver(true);
            }}
            onDragLeave={() => setStudioDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setStudioDragOver(false);
              void pickStudioFile(e.dataTransfer.files?.[0]);
            }}
            className={`flex h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-sm ${
              studioDragOver ? "border-blue-400 bg-blue-50/50" : "border-muted-foreground/25 hover:bg-muted/30"
            }`}
          >
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              disabled={!canEdit || studioBusy}
              onChange={(e) => {
                void pickStudioFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {studioFile ? (
              <>
                <span className="font-medium">{studioFile.name}</span>
                <span className="text-xs text-muted-foreground">クリックで選び直し</span>
              </>
            ) : (
              <>
                <span>Studio自社同接CSVをドロップ、またはクリックして選択</span>
                <span className="text-xs text-muted-foreground">.csv（UTF-8 / Shift_JIS 両対応）</span>
              </>
            )}
          </label>
          <p className="text-[11px] text-muted-foreground">
            ファイル名に日付・レース名があると動画を推測します（例「ライブ 【競輪ライブ6_21】#高松宮記念杯競輪 …」→ 6/21・高松宮記念）。推測できない場合は候補から手動で選べます。
          </p>

          {!canEdit && probed && (
            <span className="text-xs text-muted-foreground">投入にはログインが必要です</span>
          )}

          {studioBusy && !studioPreview && !studioResult && (
            <div className="py-2 text-center text-sm text-muted-foreground">解析中…</div>
          )}

          {/* プレビュー（計算値＋推測動画の確認） */}
          {studioPreview && !studioResult && (
            <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <span>
                  最大同接 <span className="font-semibold tabular-nums">{formatNumber(studioPreview.max_concurrent)}</span>
                </span>
                <span>
                  平均同接 <span className="font-semibold tabular-nums">{formatNumber(studioPreview.avg_concurrent)}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatNumber(studioPreview.row_count)} 行
                  {studioPreview.race_name ? `・推測: ${studioPreview.parsed_month}/${studioPreview.parsed_day} ${studioPreview.race_name}` : "・ファイル名から日付/レース名を推測できませんでした"}
                </span>
              </div>

              <label className="block text-xs text-muted-foreground">
                保存先の自社動画（確認・修正してください）
                <select
                  value={studioSelectedId}
                  onChange={(e) => setStudioSelectedId(e.target.value)}
                  disabled={studioBusy}
                  className="mt-1 block w-full rounded-md border bg-background px-2 py-1 text-sm disabled:opacity-50"
                >
                  <option value="">— 動画を選択 —</option>
                  {studioPreview.candidates.map((c) => (
                    <option key={c.video_id} value={c.video_id}>
                      {c.date_match ? "★ " : ""}
                      {c.published_at ? `${formatDate(c.published_at)} ` : ""}
                      {c.title}
                    </option>
                  ))}
                </select>
              </label>
              {studioPreview.suggested_video_id == null && (
                <p className="text-[11px] text-amber-700">
                  ⚠ ファイル名から動画を自動推測できませんでした。候補から正しい自社動画を選んでください。
                </p>
              )}

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleStudioCommit()}
                  disabled={!studioSelectedId || !canEdit || studioBusy}
                  className="rounded-md bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {studioBusy ? "保存中…" : "この動画に保存（Studio値で上書き）"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStudioFile(null);
                    setStudioPreview(null);
                    setStudioSelectedId("");
                    setStudioError(null);
                  }}
                  disabled={studioBusy}
                  className="rounded border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
                >
                  キャンセル
                </button>
              </div>
            </div>
          )}

          {/* エラー / 結果 */}
          {studioError && (
            <div className="rounded-md border border-red-200 bg-red-50/50 p-3 text-sm text-red-600">
              {studioError}
            </div>
          )}
          {studioResult && (
            <div className="rounded-md border border-green-200 bg-green-50/50 p-3 text-sm">
              <div className="font-medium text-green-800">
                上書き保存しました: {studioResult.title}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>最大同接 {formatNumber(studioResult.max_concurrent)}</span>
                <span>平均同接 {formatNumber(studioResult.avg_concurrent)}</span>
                <span>{formatNumber(studioResult.row_count)} 行から算出</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 取り込みの修正・削除（月・種別を指定して物理削除。二段階確認＋プレビュー） */}
      <Card className="border-red-200">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">取り込みの修正・削除</CardTitle>
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
            取り込みミスの修正用。月次データ（数値／性別年齢／動画別）を「対象月＋種別（＋セグメント）」で削除します。
            削除前に件数をプレビューし、確認のうえ実行します。<span className="text-red-600">この操作は元に戻せません。</span>
            指定した範囲のみ削除し、他の月・他テーブルには影響しません。通常CSV／ショートCSVは取り込み単位を特定できないため対象外です。
          </p>

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              種別
              <select
                value={delKind}
                onChange={(e) => setDelKind(e.target.value as DeletableKind)}
                disabled={!canEdit}
                className="rounded-md border bg-background px-2 py-1 text-sm disabled:opacity-50"
              >
                {DELETABLE_KIND_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              対象月
              <select
                value={delYM}
                onChange={(e) => setDelYM(e.target.value)}
                disabled={!canEdit}
                className="rounded-md border bg-background px-2 py-1 text-sm disabled:opacity-50"
              >
                {monthOptions.length === 0 && <option value="">—</option>}
                {monthOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            {DELETABLE_KIND_OPTIONS.find((o) => o.value === delKind)?.hasSegment && (
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                セグメント
                <select
                  value={delSegment}
                  onChange={(e) => setDelSegment(e.target.value as MonthlySegment)}
                  disabled={!canEdit}
                  className="rounded-md border bg-background px-2 py-1 text-sm disabled:opacity-50"
                >
                  {MONTHLY_SEGMENT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <button
              type="button"
              onClick={() => {
                const hasSeg = DELETABLE_KIND_OPTIONS.find((o) => o.value === delKind)?.hasSegment;
                void openDeleteFlow({
                  kind: delKind,
                  yearMonth: delYM,
                  segment: hasSeg ? delSegment : null,
                });
              }}
              disabled={!canEdit || !delYM || delBusy}
              className="rounded-md border border-red-300 bg-red-50 px-4 py-1.5 text-sm text-red-700 hover:bg-red-100 disabled:opacity-50"
            >
              削除プレビュー
            </button>
            {!canEdit && probed && (
              <span className="text-xs text-muted-foreground">削除にはログインが必要です</span>
            )}
          </div>
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
                    <th className="px-2 py-2 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => {
                    const at = l.completed_at ?? l.started_at;
                    const undoTarget = logToDeleteTarget(l);
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
                        <td className="px-2 py-2 whitespace-nowrap">
                          {undoTarget ? (
                            <button
                              type="button"
                              onClick={() => void openDeleteFlow(undoTarget)}
                              disabled={!canEdit || delBusy}
                              className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                            >
                              取り消し
                            </button>
                          ) : (
                            <span
                              className="text-[11px] text-muted-foreground/60"
                              title="この種別は取り消し非対応です。月次データは上の「取り込みの修正・削除」から月・種別を指定して削除してください。"
                            >
                              —
                            </span>
                          )}
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

      {/* ③ 削除の二段階確認モーダル（プレビュー → 確認 → 実行） */}
      <Modal open={delModalOpen} onClose={closeDeleteModal} title="データ削除の確認">
        {delResult ? (
          <div className="space-y-4">
            <div className="rounded-md border border-green-200 bg-green-50/50 p-3 text-sm text-green-800">
              {DELETABLE_KIND_OPTIONS.find((o) => o.value === delResult.kind)?.label}（
              {delResult.table}）の {formatYearMonthLabel(delResult.year_month)}
              {delResult.segment ? `・${MONTHLY_SEGMENT_LABEL[delResult.segment]}` : ""} を{" "}
              <span className="font-semibold">{formatNumber(delResult.deleted)} 件</span> 削除しました。
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={closeDeleteModal}
                className="rounded-md bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700"
              >
                閉じる
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {delError && (
              <div className="rounded-md border border-red-200 bg-red-50/50 p-3 text-sm text-red-600">
                {delError}
              </div>
            )}

            {delBusy && !delPreview ? (
              <div className="py-4 text-center text-sm text-muted-foreground">件数を確認中…</div>
            ) : delPreview ? (
              <>
                <div className="rounded-md border bg-muted/30 p-3 text-sm">
                  <span className="font-medium">
                    {DELETABLE_KIND_OPTIONS.find((o) => o.value === delPreview.kind)?.label}
                  </span>
                  （{delPreview.table}）の{" "}
                  <span className="font-medium">{formatYearMonthLabel(delPreview.year_month)}</span>
                  {delPreview.segment ? `・${MONTHLY_SEGMENT_LABEL[delPreview.segment]}` : ""} を{" "}
                  <span className="font-semibold text-red-700">
                    {formatNumber(delPreview.count)} 件
                  </span>{" "}
                  削除します。
                  {delPreview.count === 0 && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      対象データがありません（削除するものはありません）。
                    </div>
                  )}
                </div>
                <p className="text-sm text-red-600">
                  この操作は元に戻せません。指定した範囲（対象月{delPreview.segment ? "・セグメント" : ""}）のみを削除し、他の月・他テーブルには影響しません。
                </p>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={delConfirmChecked}
                    onChange={(e) => setDelConfirmChecked(e.target.checked)}
                    disabled={delPreview.count === 0 || delBusy}
                  />
                  この操作は元に戻せないことを理解しました
                </label>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeDeleteModal}
                    disabled={delBusy}
                    className="rounded-md border px-4 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    onClick={() => void confirmDelete()}
                    disabled={!delConfirmChecked || delBusy || delPreview.count === 0}
                    className="rounded-md bg-red-600 px-4 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {delBusy ? "削除中…" : "削除する"}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        )}
      </Modal>

      <LoginDialog open={loginOpen} onClose={() => setLoginOpen(false)} />
    </main>
  );
}
