import * as SecureStore from "expo-secure-store";

const ACCESS_KEY = "qchat.access_token";
const REFRESH_KEY = "qchat.refresh_token";

let accessToken: string | null = null;
let refreshToken: string | null = null;
let ready: Promise<void> | null = null;
let onUnauthorized: (() => void) | null = null;

export function setOnUnauthorized(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export function apiBaseUrl(): string {
  return (process.env.EXPO_PUBLIC_API_URL ?? "http://192.168.91.136:8080").replace(/\/$/, "");
}

export async function initTokens(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      accessToken = await SecureStore.getItemAsync(ACCESS_KEY);
      refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
    })();
  }
  await ready;
}

export function getToken(): string | null {
  return accessToken;
}

export function getRefreshToken(): string | null {
  return refreshToken;
}

export async function setTokens(access: string, refresh: string): Promise<void> {
  accessToken = access;
  refreshToken = refresh || null;
  await SecureStore.setItemAsync(ACCESS_KEY, access);
  if (refresh) {
    await SecureStore.setItemAsync(REFRESH_KEY, refresh);
  } else {
    await SecureStore.deleteItemAsync(REFRESH_KEY);
  }
}

export async function clearToken(): Promise<void> {
  accessToken = null;
  refreshToken = null;
  await SecureStore.deleteItemAsync(ACCESS_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
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
          await clearToken();
          return false;
        }
        const data = body?.data ?? body;
        await setTokens(String(data.access_token), String(data.refresh_token ?? refresh));
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

export async function ensureAccessToken(): Promise<boolean> {
  await initTokens();
  const token = getToken();
  if (token && !accessTokenExpiresSoon(token)) return true;
  if (!getRefreshToken()) return Boolean(token);
  return refreshAccess();
}

export async function api<T = any>(
  path: string,
  init: RequestInit = {},
  _retried = false
): Promise<T> {
  await initTokens();
  const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(init.body && !isForm ? { "Content-Type": "application/json" } : {}),
    ...(init.headers as Record<string, string> | undefined),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

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
    await clearToken();
    onUnauthorized?.();
  }

  if (!res.ok) {
    const msg =
      (body as any)?.message ?? (body as any)?.error ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, String(msg), body);
  }
  if (body && typeof body === "object" && "data" in (body as any)) {
    return (body as any).data as T;
  }
  return body as T;
}

export function asList(body: any, ...keys: string[]): any[] {
  if (Array.isArray(body)) return body;
  for (const k of [...keys, "items", "list", "records", "results"]) {
    if (Array.isArray(body?.[k])) return body[k];
  }
  return [];
}

export function wsUrl(): string {
  const token = getToken() ?? "";
  const base = apiBaseUrl().replace(/^http/, "ws");
  return `${base}/v1/ws?token=${encodeURIComponent(token)}`;
}

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
