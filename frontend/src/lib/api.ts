// バックエンド API への fetch ラッパ。
// ベースURLは NEXT_PUBLIC_API_BASE_URL（既定 http://localhost:8000）。

import { getToken } from "@/lib/auth";
import type { HomeResponse } from "@/types/dashboard";
import type { EventLite, Page, Video, VideoUpdate } from "@/types/video";

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

export async function apiGet<T>(path: string, params?: QueryParams): Promise<T> {
  const url = new URL(path, API_BASE_URL);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
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

export function getEvents(params?: QueryParams): Promise<Page<EventLite>> {
  return apiGet<Page<EventLite>>("/api/events", params);
}

export function patchVideo(id: string, body: VideoUpdate): Promise<Video> {
  return apiPatch<Video>(`/api/videos/${id}`, body);
}
