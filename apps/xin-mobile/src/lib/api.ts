import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

const ACCESS_KEY = "xinchat.access_token";
const REFRESH_KEY = "xinchat.refresh_token";
const SESSION_REVOKED_KEY = "xinchat.session_revoked";

let accessToken: string | null = null;
let refreshToken: string | null = null;
let ready: Promise<void> | null = null;
let onUnauthorized: (() => void) | null = null;
let sessionRevokedReason: string | null = null;

export function setOnUnauthorized(fn: (() => void) | null) {
  onUnauthorized = fn;
}

function embeddedApiUrl(): string {
  const extra = Constants.expoConfig?.extra as
    | { apiUrl?: string; appEnv?: string }
    | undefined;
  return String(extra?.apiUrl ?? "").trim();
}

function embeddedAppEnv(): string {
  const extra = Constants.expoConfig?.extra as { appEnv?: string } | undefined;
  return String(
    extra?.appEnv ||
      process.env.APP_ENV ||
      process.env.EAS_BUILD_PROFILE ||
      ""
  ).toLowerCase();
}

export function apiBaseUrl(): string {
  const raw =
    process.env.EXPO_PUBLIC_API_URL?.trim() || embeddedApiUrl() || "";
  const appEnv = embeddedAppEnv();
  const isRelease =
    appEnv === "production" ||
    appEnv === "preview" ||
    (!__DEV__ && process.env.NODE_ENV === "production");

  if (!raw) {
    if (isRelease) {
      throw new Error(
        "EXPO_PUBLIC_API_URL is required for preview/production mobile builds"
      );
    }
    // Local LAN fallback for Metro / emulator tunnels only.
    return "http://192.168.91.136:8080";
  }
  return raw.replace(/\/$/, "");
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

/** Persist why this device was signed out (same-type kick / ban). */
export async function setSessionRevokedReason(reason: string): Promise<void> {
  sessionRevokedReason = reason || "replaced";
  await SecureStore.setItemAsync(SESSION_REVOKED_KEY, sessionRevokedReason);
}

/** Consume and clear the revoke banner reason (login screen). */
export async function takeSessionRevokedReason(): Promise<string | null> {
  if (sessionRevokedReason) {
    const r = sessionRevokedReason;
    sessionRevokedReason = null;
    await SecureStore.deleteItemAsync(SESSION_REVOKED_KEY).catch(() => {});
    return r;
  }
  const stored = await SecureStore.getItemAsync(SESSION_REVOKED_KEY);
  if (stored) {
    await SecureStore.deleteItemAsync(SESSION_REVOKED_KEY).catch(() => {});
    return stored;
  }
  return null;
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

export type MediaUploadResult = {
  url: string;
  kind?: string;
  size?: number;
};

export type UploadProgressFn = (loaded: number, total: number) => void;

/**
 * Upload local media via XHR so callers get progress + AbortSignal cancel
 * (mirrors web uploadMedia).
 */
export async function uploadMedia(
  localUri: string,
  kind: "image" | "file" | "voice" | "video" | "avatar",
  filename: string,
  mimeType = "application/octet-stream",
  onProgress?: UploadProgressFn,
  signal?: AbortSignal
): Promise<MediaUploadResult> {
  await ensureAccessToken();
  if (signal?.aborted) {
    throw new ApiError(0, "upload aborted", null);
  }

  const doUpload = (retried: boolean) =>
    new Promise<MediaUploadResult>((resolve, reject) => {
      const form = new FormData();
      form.append("file", {
        uri: localUri,
        name: filename,
        type: mimeType,
      } as any);
      form.append("kind", kind);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${apiBaseUrl()}/v1/media/upload`);
      const token = getToken();
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

      const onAbort = () => {
        xhr.abort();
      };
      if (signal) {
        if (signal.aborted) {
          reject(new ApiError(0, "upload aborted", null));
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      const cleanup = () => {
        signal?.removeEventListener("abort", onAbort);
      };

      xhr.upload.onprogress = (ev) => {
        if (!onProgress || !ev.lengthComputable || ev.total <= 0) return;
        onProgress(ev.loaded, ev.total);
      };

      xhr.onload = () => {
        cleanup();
        let body: any = null;
        const text = xhr.responseText;
        if (text) {
          try {
            body = JSON.parse(text);
          } catch {
            body = text;
          }
        }
        if (xhr.status === 401 && !retried) {
          refreshAccess()
            .then((ok) => {
              if (ok) {
                doUpload(true).then(resolve, reject);
                return;
              }
              void clearToken();
              onUnauthorized?.();
              reject(new ApiError(401, "unauthorized", body));
            })
            .catch(reject);
          return;
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          const msg =
            body?.message ??
            body?.error ??
            (xhr.status === 413 ? "File too large" : `upload failed (${xhr.status})`);
          reject(new ApiError(xhr.status, String(msg), body));
          return;
        }
        const data = body?.data ?? body;
        resolve({
          url: String(data?.url ?? data?.media_url ?? ""),
          kind: data?.kind,
          size: data?.size,
        });
      };

      xhr.onerror = () => {
        cleanup();
        reject(new ApiError(0, "upload failed", null));
      };
      xhr.onabort = () => {
        cleanup();
        reject(new ApiError(0, "upload aborted", null));
      };

      xhr.send(form);
    });

  return doUpload(false);
}
