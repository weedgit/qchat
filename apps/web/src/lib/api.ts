export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NODE_ENV === "development" ? "http://localhost:8080" : "");

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
        const res = await fetch(`${API_URL}/v1/auth/refresh`, {
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

  const res = await fetch(`${API_URL}${path}`, { ...init, headers });

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
  let origin = API_URL;
  if (!origin && typeof window !== "undefined") origin = window.location.origin;
  const base = origin.replace(/^http/, "ws");
  return `${base}/v1/ws?token=${encodeURIComponent(token)}`;
}
