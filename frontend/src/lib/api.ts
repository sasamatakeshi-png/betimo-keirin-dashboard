// バックエンド API への fetch ラッパ。
// ベースURLは NEXT_PUBLIC_API_BASE_URL（既定 http://localhost:8000）。

import { getToken } from "@/lib/auth";
import type {
  AnalysisResult,
  AnalysisRunResult,
  AnalysisTemplate,
} from "@/types/analysis";
import type {
  ChannelStatsResponse,
  HomeResponse,
  MonthlyDemographicsResponse,
  MonthlyMetricsResponse,
  MonthlyVideoCountsResponse,
  WebcmMonthlyResponse,
} from "@/types/dashboard";
import type { RaceGroup } from "@/types/concurrent";
import type { EventSummary } from "@/types/event-summary";
import type {
  ProgramCandidatesResponse,
  ProgramDetailResponse,
} from "@/types/program-comparison";
import type {
  DeletableKind,
  ConcurrentUploadResult,
  DeletePreviewResult,
  DeleteResult,
  IngestionLog,
  IngestType,
  MonthlyKind,
  MonthlySegment,
  MonthlyUploadResult,
  MonthlyVideoUploadResult,
  ShortIngestType,
  UploadResult,
} from "@/types/ingestion";
import type {
  Channel,
  EventLite,
  Page,
  TimeseriesPoint,
  Video,
  VideoUpdate,
} from "@/types/video";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type QueryParams = Record<string, string | number | undefined | null>;

export async function apiGet<T>(
  path: string,
  params?: QueryParams,
  opts?: { auth?: boolean },
): Promise<T> {
  const url = new URL(path, API_BASE_URL);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts?.auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), { headers });
  } catch {
    throw new ApiError(0, `APIサーバーに接続できません（${API_BASE_URL}）`);
  }

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = String(body.detail);
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }

  return (await res.json()) as T;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(new URL(path, API_BASE_URL).toString(), {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, `APIサーバーに接続できません（${API_BASE_URL}）`);
  }

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const b = await res.json();
      if (b?.detail) detail = String(b.detail);
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

// --- エンドポイント別ヘルパ ---

export function getDashboardHome(params?: {
  date_from?: string;
  date_to?: string;
}): Promise<HomeResponse> {
  return apiGet<HomeResponse>("/api/dashboard/home", params);
}

// --- 月次（ホーム刷新用・認証不要GET） ---

export function getMonthlyMetrics(
  segment: MonthlySegment,
  dateFrom?: string,
  dateTo?: string,
): Promise<MonthlyMetricsResponse> {
  return apiGet<MonthlyMetricsResponse>("/api/dashboard/monthly-metrics", {
    segment,
    date_from: dateFrom,
    date_to: dateTo,
  });
}

export function getMonthlyDemographics(
  segment: MonthlySegment,
  yearMonth?: string,
): Promise<MonthlyDemographicsResponse> {
  return apiGet<MonthlyDemographicsResponse>("/api/dashboard/monthly-demographics", {
    segment,
    year_month: yearMonth,
  });
}

export function getMonthlyVideoCounts(): Promise<MonthlyVideoCountsResponse> {
  return apiGet<MonthlyVideoCountsResponse>("/api/dashboard/monthly-video-counts");
}

// WebCM（広告）の月別再生数（monthly_video_metrics の is_ad=true 集計。確認用）。
export function getWebcmMonthly(): Promise<WebcmMonthlyResponse> {
  return apiGet<WebcmMonthlyResponse>("/api/dashboard/webcm-monthly");
}

// 総登録者数・総再生数の最新スナップショット（YouTube API。認証不要GET）。
// サーバ側で「最終取得が24h超なら再取得」する遅延更新つき。取得失敗でも
// 既存値 or null を返すため、呼び出し側は通常 catch 不要だが、ホーム全体を
// 守るため page 側では .catch(() => null) で握って描画を継続する。
export function getChannelStats(): Promise<ChannelStatsResponse> {
  return apiGet<ChannelStatsResponse>("/api/dashboard/channel-stats");
}

// --- 番組比較（レポートP4。母集団=自社regular・program_typeありの142本。認証不要GET） ---

// 比較対象に選べる番組一覧。race(レース名 title/event 部分一致) / program_type(種別) /
// year_month(公開月 'YYYY-MM') で絞り込める（いずれも任意。指定なしで全142本）。
export function getProgramCandidates(params?: {
  race?: string;
  program_type?: string;
  year_month?: string;
}): Promise<ProgramCandidatesResponse> {
  return apiGet<ProgramCandidatesResponse>(
    "/api/program-comparison/candidates",
    params,
  );
}

// 指定番組（UUIDカンマ区切り）の詳細指標。母集団外/不正IDは not_found に入る。
export function getProgramDetail(
  videoIds: string[],
): Promise<ProgramDetailResponse> {
  return apiGet<ProgramDetailResponse>("/api/program-comparison/detail", {
    video_ids: videoIds.join(","),
  });
}

export function getVideos(params?: QueryParams): Promise<Page<Video>> {
  return apiGet<Page<Video>>("/api/videos", params);
}

// サーバの 1 ページ上限（MAX_LIMIT=200）。これを超える件数は複数ページで取得する。
const VIDEOS_PAGE_LIMIT = 200;
// 無限ループ防止の安全上限（最大 50 ページ = 10,000 件）。
const VIDEOS_MAX_PAGES = 50;

// /videos・/shorts 用: total に達するまで offset を進めて全ページ取得し結合する。
// limit/offset は内部管理するため、呼び出し側が渡しても無視（上書き）する。
export async function getAllVideos(params?: QueryParams): Promise<Video[]> {
  const base: QueryParams = { ...(params ?? {}) };
  delete base.limit;
  delete base.offset;

  const all: Video[] = [];
  for (let page = 0; page < VIDEOS_MAX_PAGES; page += 1) {
    const res = await getVideos({
      ...base,
      limit: VIDEOS_PAGE_LIMIT,
      offset: page * VIDEOS_PAGE_LIMIT,
    });
    all.push(...res.items);
    // 最終ページ（取得数が上限未満＝空含む）か、total 到達で停止
    if (res.items.length < VIDEOS_PAGE_LIMIT) break;
    if (all.length >= res.total) break;
  }
  return all;
}

export function getVideo(id: string): Promise<Video> {
  return apiGet<Video>(`/api/videos/${id}`);
}

export function getTimeseries(
  entityId: string,
  metricKey: string,
): Promise<Page<TimeseriesPoint>> {
  return apiGet<Page<TimeseriesPoint>>("/api/timeseries", {
    entity_id: entityId,
    metric_key: metricKey,
    limit: 200,
  });
}

export function getChannels(): Promise<Page<Channel>> {
  return apiGet<Page<Channel>>("/api/channels", { limit: 50 });
}

// 同接データを持つレース一覧（競合1社以上の日のみ・日付の新しい順）。認証不要GET。
export function getConcurrentRaces(): Promise<RaceGroup[]> {
  return apiGet<RaceGroup[]>("/api/concurrent/races");
}

export function getEvents(params?: QueryParams): Promise<Page<EventLite>> {
  return apiGet<Page<EventLite>>("/api/events", params);
}

export function getEvent(id: string): Promise<EventLite> {
  return apiGet<EventLite>(`/api/events/${id}`);
}

export function getEventSummary(id: string): Promise<EventSummary> {
  return apiGet<EventSummary>(`/api/events/${id}/summary`);
}

export function patchVideo(id: string, body: VideoUpdate): Promise<Video> {
  return apiPatch<Video>(`/api/videos/${id}`, body);
}

// --- 取り込み（要ログイン） ---

export async function uploadIngestionCsv(
  file: File,
  type: IngestType,
): Promise<UploadResult> {
  const token = getToken();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const form = new FormData();
  form.append("file", file);
  form.append("type", type);

  let res: Response;
  try {
    res = await fetch(new URL("/api/ingestion/upload", API_BASE_URL).toString(), {
      method: "POST",
      headers,
      body: form,
    });
  } catch {
    throw new ApiError(0, `APIサーバーに接続できません（${API_BASE_URL}）`);
  }
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const b = await res.json();
      if (b?.detail) detail = String(b.detail);
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as UploadResult;
}

export function getIngestionLogs(): Promise<Page<IngestionLog>> {
  return apiGet<Page<IngestionLog>>("/api/ingestion/logs", { limit: 20 }, { auth: true });
}

// 削除プレビュー（件数のみ・読み取り専用。要ログイン）。実際には何も消さない。
export function getDeletePreview(
  kind: DeletableKind,
  yearMonth: string,
  segment?: MonthlySegment | null,
): Promise<DeletePreviewResult> {
  return apiGet<DeletePreviewResult>(
    "/api/ingestion/delete-preview",
    { kind, year_month: yearMonth, segment: segment ?? undefined },
    { auth: true },
  );
}

// 月次データの削除（要ログイン）。指定した月[+segment]のみを物理削除する。
export async function deleteMonthlyData(
  kind: DeletableKind,
  yearMonth: string,
  segment?: MonthlySegment | null,
): Promise<DeleteResult> {
  const token = getToken();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const url = new URL("/api/ingestion/monthly", API_BASE_URL);
  url.searchParams.set("kind", kind);
  url.searchParams.set("year_month", yearMonth);
  if (segment) url.searchParams.set("segment", segment);

  let res: Response;
  try {
    res = await fetch(url.toString(), { method: "DELETE", headers });
  } catch {
    throw new ApiError(0, `APIサーバーに接続できません（${API_BASE_URL}）`);
  }
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const b = await res.json();
      if (b?.detail) detail = String(b.detail);
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as DeleteResult;
}

// 月次CSV（チャンネル全体データ）の投入（要ログイン）。
// file / year_month('YYYY-MM') / segment / kind を multipart で送る。
export async function uploadMonthlyCsv(
  file: File,
  yearMonth: string,
  segment: MonthlySegment,
  kind: MonthlyKind,
): Promise<MonthlyUploadResult> {
  const token = getToken();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const form = new FormData();
  form.append("file", file);
  form.append("year_month", yearMonth);
  form.append("segment", segment);
  form.append("kind", kind);

  let res: Response;
  try {
    res = await fetch(new URL("/api/ingestion/monthly", API_BASE_URL).toString(), {
      method: "POST",
      headers,
      body: form,
    });
  } catch {
    throw new ApiError(0, `APIサーバーに接続できません（${API_BASE_URL}）`);
  }
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const b = await res.json();
      if (b?.detail) detail = String(b.detail);
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as MonthlyUploadResult;
}

// 動画別CSV（月 × 動画）の投入（要ログイン）。file / year_month を multipart で送る。
export async function uploadMonthlyVideoCsv(
  file: File,
  yearMonth: string,
): Promise<MonthlyVideoUploadResult> {
  const token = getToken();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const form = new FormData();
  form.append("file", file);
  form.append("year_month", yearMonth);

  let res: Response;
  try {
    res = await fetch(new URL("/api/ingestion/monthly-video", API_BASE_URL).toString(), {
      method: "POST",
      headers,
      body: form,
    });
  } catch {
    throw new ApiError(0, `APIサーバーに接続できません（${API_BASE_URL}）`);
  }
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const b = await res.json();
      if (b?.detail) detail = String(b.detail);
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as MonthlyVideoUploadResult;
}

// ショート専用CSVの投入（要ログイン）。通常CSVと同じ /upload に別 type で送る。
export async function uploadShortCsv(
  file: File,
  type: ShortIngestType,
): Promise<UploadResult> {
  const token = getToken();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const form = new FormData();
  form.append("file", file);
  form.append("type", type);

  let res: Response;
  try {
    res = await fetch(new URL("/api/ingestion/upload", API_BASE_URL).toString(), {
      method: "POST",
      headers,
      body: form,
    });
  } catch {
    throw new ApiError(0, `APIサーバーに接続できません（${API_BASE_URL}）`);
  }
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const b = await res.json();
      if (b?.detail) detail = String(b.detail);
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as UploadResult;
}

// 同時接続数xlsx（1ファイル=1レース1日）の投入（要ログイン）。file のみ multipart で送る。
export async function uploadConcurrentXlsx(
  file: File,
): Promise<ConcurrentUploadResult> {
  const token = getToken();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const form = new FormData();
  form.append("file", file);

  let res: Response;
  try {
    res = await fetch(new URL("/api/ingestion/concurrent", API_BASE_URL).toString(), {
      method: "POST",
      headers,
      body: form,
    });
  } catch {
    throw new ApiError(0, `APIサーバーに接続できません（${API_BASE_URL}）`);
  }
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const b = await res.json();
      if (b?.detail) detail = String(b.detail);
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as ConcurrentUploadResult;
}

// --- AI分析 ---

// 画面種別(event_detail / video_detail)で有効なテンプレを引く（認証不要）。
export function getAnalysisTemplates(
  screenType: string,
): Promise<Page<AnalysisTemplate>> {
  return apiGet<Page<AnalysisTemplate>>("/api/analysis/templates", {
    screen_type: screenType,
    limit: 50,
  });
}

// 対象 entity の保存済み分析結果（generated_at 降順, 先頭が最新）（認証不要）。
export function getAnalysisResults(
  entityType: string,
  entityId: string,
): Promise<Page<AnalysisResult>> {
  return apiGet<Page<AnalysisResult>>("/api/analysis/results", {
    entity_type: entityType,
    entity_id: entityId,
    limit: 1,
  });
}

// 分析を生成（要ログイン。apiPatch と同じくトークンを Bearer 付与）。
export async function runAnalysis(body: {
  entity_type: string;
  entity_id: string;
  template_id?: string;
  prompt?: string;
  tone?: string;
  length?: string;
}): Promise<AnalysisRunResult> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(new URL("/api/analysis/run", API_BASE_URL).toString(), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, `APIサーバーに接続できません（${API_BASE_URL}）`);
  }
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const b = await res.json();
      if (b?.detail) detail = String(b.detail);
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as AnalysisRunResult;
}
