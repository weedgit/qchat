/** API origin: env override, else same host as the page on :8080 (LAN-friendly). */
export function apiBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:8080`;
  }
  return process.env.NODE_ENV === "development" ? "http://localhost:8080" : "";
}

/** @deprecated prefer apiBaseUrl() — kept for call sites that need a sync string at import time in the browser. */
export const API_URL =
  typeof window !== "undefined" ? apiBaseUrl() : process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

const ACCESS_KEY = "qchat.access_token";
const REFRESH_KEY = "qchat.refresh_token";
const REMEMBER_KEY = "qchat.remember";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACCESS_KEY) ?? sessionStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(REFRESH_KEY) ?? sessionStorage.getItem(REFRESH_KEY);
}

function storage(remember: boolean): Storage {
  return remember ? localStorage : sessionStorage;
}

export function setTokens(access: string, refresh: string, remember: boolean) {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  sessionStorage.removeItem(ACCESS_KEY);
  sessionStorage.removeItem(REFRESH_KEY);
  const s = storage(remember);
  s.setItem(ACCESS_KEY, access);
  if (refresh) s.setItem(REFRESH_KEY, refresh);
  localStorage.setItem(REMEMBER_KEY, remember ? "1" : "0");
}

/** @deprecated use setTokens */
export function setToken(token: string, remember: boolean) {
  setTokens(token, getRefreshToken() ?? "", remember);
}

export function clearToken() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  sessionStorage.removeItem(ACCESS_KEY);
  sessionStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(REMEMBER_KEY);
}

function remembered(): boolean {
  return localStorage.getItem(REMEMBER_KEY) === "1";
}

export class ApiError extends Error {
  status: number;
  code: string;
  body: unknown;
  fields?: Record<string, string>;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
    this.code = String((body as any)?.code ?? "error");
    this.fields = (body as any)?.fields;
  }
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshAccess(): Promise<boolean> {
  const refresh = getRefreshToken();
  if (!refresh) return false;
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await fetch(`${apiBaseUrl()}/v1/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refresh }),
        });
        const text = await res.text();
        let body: any = null;
        if (text) {
          try {
            body = JSON.parse(text);
          } catch {
            body = text;
          }
        }
        if (!res.ok) {
          clearToken();
          return false;
        }
        setTokens(String(body.access_token), String(body.refresh_token ?? ""), remembered());
        return true;
      } catch {
        return false;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

function accessTokenExpiresSoon(token: string, skewMs = 60_000): boolean {
  try {
    const part = token.split(".")[1];
    if (!part) return true;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json);
    const exp = Number(payload?.exp);
    if (!exp) return true;
    return exp * 1000 <= Date.now() + skewMs;
  } catch {
    return true;
  }
}

/** Refresh access token when missing or near expiry (used by WebSocket connect). */
export async function ensureAccessToken(): Promise<boolean> {
  const token = getToken();
  if (token && !accessTokenExpiresSoon(token)) return true;
  if (!getRefreshToken()) return Boolean(token);
  return refreshAccess();
}

function redirectLogin() {
  if (typeof window === "undefined") return;
  if (!window.location.pathname.startsWith("/login")) {
    window.location.replace("/login");
  }
}

export async function api<T = any>(
  path: string,
  init: RequestInit = {},
  _retried = false
): Promise<T> {
  const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(init.body && !isForm ? { "Content-Type": "application/json" } : {}),
    ...(init.headers as Record<string, string> | undefined),
  };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${apiBaseUrl()}${path}`, { ...init, headers });

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (res.status === 401 && !_retried && !path.startsWith("/v1/auth/")) {
    const ok = await refreshAccess();
    if (ok) return api<T>(path, init, true);
    clearToken();
    redirectLogin();
  }

  if (!res.ok) {
    const msg =
      (body as any)?.message ??
      (body as any)?.error ??
      `Request failed (${res.status})`;
    throw new ApiError(res.status, String(msg), body);
  }
  if (body && typeof body === "object" && "data" in (body as any)) {
    return (body as any).data as T;
  }
  return body as T;
}

/** Extract a list from either a bare array or { items | list | users | ... } envelopes. */
export function asList(body: any, ...keys: string[]): any[] {
  if (Array.isArray(body)) return body;
  for (const k of [...keys, "items", "list", "records", "results"]) {
    if (Array.isArray(body?.[k])) return body[k];
  }
  return [];
}

export function wsUrl(): string {
  const token = getToken() ?? "";
  let origin = apiBaseUrl();
  if (!origin && typeof window !== "undefined") origin = window.location.origin;
  const base = origin.replace(/^http/, "ws");
  return `${base}/v1/ws?token=${encodeURIComponent(token)}`;
}

/** Absolute media URL with access token for <audio>/<img> tags. */
export function mediaAuthURL(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (path.startsWith("data:") || path.startsWith("blob:")) return path;
  if (path.startsWith("http://") || path.startsWith("https://")) {
    if (path.includes("/v1/media/")) {
      const token = getToken();
      if (token && !path.includes("token=")) {
        return `${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
      }
    }
    return path;
  }
  const rel = path.startsWith("/") ? path : `/${path}`;
  const abs = `${apiBaseUrl()}${rel}`;
  const token = getToken();
  if (rel.startsWith("/v1/media/") && token) {
    return `${abs}${abs.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
  }
  return abs;
}

export async function uploadMedia(
  file: Blob,
  kind: string,
  filename: string
): Promise<{ id: string; url: string; content_type: string; size: number; kind: string }> {
  const form = new FormData();
  form.append("file", file, filename);
  form.append("kind", kind);
  return api("/v1/media/upload", { method: "POST", body: form });
}
