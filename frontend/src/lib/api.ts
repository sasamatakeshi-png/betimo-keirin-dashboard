// バックエンド API への fetch ラッパ。
// ベースURLは NEXT_PUBLIC_API_BASE_URL（既定 http://localhost:8000）。

import type { HomeResponse } from "@/types/dashboard";

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

// --- エンドポイント別ヘルパ ---

export function getDashboardHome(params?: {
  date_from?: string;
  date_to?: string;
}): Promise<HomeResponse> {
  return apiGet<HomeResponse>("/api/dashboard/home", params);
}
