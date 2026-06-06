// 簡易認証: POST /api/auth/login で token 取得し、メモリ + localStorage に保持。
// PATCH 時に api.ts が getToken() を Authorization に付与する。
// APP_PASSWORD 未設定環境では auth_required:false が返るため、ログイン不要で編集可。

import { useSyncExternalStore } from "react";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const LS_KEY = "betimo_token";

interface AuthState {
  token: string | null;
  authRequired: boolean | null; // null=未判定
  probed: boolean;
}

let state: AuthState = { token: null, authRequired: null, probed: false };
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function setState(patch: Partial<AuthState>): void {
  state = { ...state, ...patch };
  emit();
}

function persist(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem(LS_KEY, token);
  else localStorage.removeItem(LS_KEY);
}

interface LoginResponse {
  token: string;
  auth_required: boolean;
}

async function postLogin(password: string): Promise<LoginResponse> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const err = new Error(
      res.status === 401 ? "パスワードが違います" : `ログイン失敗 (${res.status})`,
    );
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return (await res.json()) as LoginResponse;
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getSnapshot(): AuthState {
  return state;
}

export function getToken(): string | null {
  return state.token;
}

async function probeAuth(): Promise<void> {
  if (state.probed) return;
  try {
    // 空パスワードで probe: dev(APP_PASSWORD未設定)なら 200+auth_required:false+token、
    // 本番なら 401。
    const r = await postLogin("");
    const token = state.token ?? r.token;
    setState({ token, authRequired: r.auth_required, probed: true });
    persist(token);
  } catch (e) {
    const status = (e as { status?: number }).status;
    setState({ authRequired: status === 401 ? true : state.authRequired, probed: true });
  }
}

export async function initAuth(): Promise<void> {
  if (typeof window === "undefined") return;
  const stored = localStorage.getItem(LS_KEY);
  if (stored && !state.token) setState({ token: stored });
  await probeAuth();
}

export async function login(password: string): Promise<LoginResponse> {
  const r = await postLogin(password);
  setState({ token: r.token, authRequired: r.auth_required, probed: true });
  persist(r.token);
  return r;
}

export function logout(): void {
  setState({ token: null });
  persist(null);
}

export interface AuthView {
  token: string | null;
  authRequired: boolean | null;
  loggedIn: boolean;
  canEdit: boolean;
  probed: boolean;
}

export function useAuth(): AuthView {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    token: s.token,
    authRequired: s.authRequired,
    loggedIn: !!s.token,
    canEdit: !!s.token || s.authRequired === false,
    probed: s.probed,
  };
}
