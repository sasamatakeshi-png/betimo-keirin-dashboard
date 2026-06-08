// バックエンド API への fetch ラッパ。
// ベースURLは NEXT_PUBLIC_API_BASE_URL（既定 http://localhost:8000）。

import { getToken } from "@/lib/auth";
import type {
  AnalysisResult,
  AnalysisRunResult,
  AnalysisTemplate,
} from "@/types/analysis";
import type { HomeResponse } from "@/types/dashboard";
import type { EventSummary } from "@/types/event-summary";
import type {
  IngestionLog,
  IngestType,
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
