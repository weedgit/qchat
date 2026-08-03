/**
 * API origin.
 * - NEXT_PUBLIC_API_URL set (including "") → use it; empty means same-origin (nginx HTTPS/HTTP).
 * - unset + browser → host:8080 (LAN next-dev without nginx).
 */
import { apiErrorMessageKey, formatApiErrorLocale } from "@qchat/i18n";

export function apiBaseUrl(): string {
  if (typeof process.env.NEXT_PUBLIC_API_URL === "string") {
    const fromEnv = process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, "");
    if (fromEnv) return fromEnv;
    if (typeof window !== "undefined") return window.location.origin;
    return "";
  }
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:8080`;
  }
  return "http://localhost:8080";
}

/** @deprecated prefer apiBaseUrl() — kept for call sites that need a sync string at import time in the browser. */
export const API_URL =
  typeof window !== "undefined" ? apiBaseUrl() : process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

const ACCESS_KEY = "qchat.access_token";
const REFRESH_KEY = "qchat.refresh_token";
const REMEMBER_KEY = "qchat.remember";

function desktopBridge(): Window["qchatDesktop"] | undefined {
  if (typeof window === "undefined") return undefined;
  return window.qchatDesktop;
}

function applyTokensLocal(access: string, refresh: string, remember: boolean) {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  sessionStorage.removeItem(ACCESS_KEY);
  sessionStorage.removeItem(REFRESH_KEY);
  const s = storage(remember);
  s.setItem(ACCESS_KEY, access);
  if (refresh) s.setItem(REFRESH_KEY, refresh);
  localStorage.setItem(REMEMBER_KEY, remember ? "1" : "0");
}

/**
 * Hydrate tokens from Electron safeStorage (AUTH-03). Call before auth gates.
 * Returns true when an access token is available afterward.
 */
export async function restoreDesktopSession(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (getToken()) return true;
  const desk = desktopBridge();
  if (!desk?.getSecureSession) return false;
  try {
    const session = await desk.getSecureSession();
    const access = String(session?.accessToken || "").trim();
    if (!access) return false;
    applyTokensLocal(access, String(session?.refreshToken || ""), true);
    return true;
  } catch {
    return false;
  }
}

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
  applyTokensLocal(access, refresh, remember);
  const desk = desktopBridge();
  if (!desk?.setSecureSession) return;
  if (remember) {
    void desk.setSecureSession({ accessToken: access, refreshToken: refresh || "" }).catch(() => {});
  } else if (desk.clearSecureSession) {
    void desk.clearSecureSession().catch(() => {});
  }
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
  const desk = desktopBridge();
  if (desk?.clearSecureSession) {
    void desk.clearSecureSession().catch(() => {});
  }
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

/** Friendly copy for failed sends/uploads shown on the message bubble. */
export function formatSendError(err: unknown, fallback = "Failed to send"): string {
  if (err instanceof ApiError) {
    if (err.status === 413) return formatApiErrorLocale(err, undefined, "api.err.fileTooLarge");
    if (err.status === 401) return formatApiErrorLocale(err, undefined, "api.err.unauthorized");
    if (err.status === 0) return formatApiErrorLocale(err, undefined, "api.err.network");
    if (err.status === 400 && /not allowed|file/i.test(err.message)) {
      return formatApiErrorLocale(err, undefined, "api.err.fileNotAllowed");
    }
    if (err.status !== undefined && err.status >= 500) {
      return formatApiErrorLocale(err, undefined, "api.err.server");
    }
    const key = apiErrorMessageKey(err, "api.err.sendFailed");
    if (key !== "common.error") return formatApiErrorLocale(err, undefined, key);
  }
  if (fallback === "Upload failed") return formatApiErrorLocale(err, undefined, "api.err.uploadFailed");
  return formatApiErrorLocale(err, undefined, "api.err.sendFailed");
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
          // Only drop the session on an explicit auth rejection — not on HTML/proxy noise.
          if (res.status === 401 || res.status === 403) {
            clearToken();
          }
          return false;
        }
        setTokens(
          String(body.access_token),
          String(body.refresh_token ?? getRefreshToken() ?? ""),
          remembered()
        );
        return true;
      } catch {
        // Transient network / TLS blip — keep tokens so splash can retry.
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

  const res = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers,
    cache: init.cache ?? "no-store",
  });

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
    // refreshAccess clears tokens only on explicit 401/403. If tokens remain,
    // this was likely a transient failure — don't hard-navigate to login.
    if (!getToken()) {
      redirectLogin();
    }
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

/** Notify the mounted chat shell that /v1/me changed (profile overlay stays mounted over chat). */
export type MeUpdatedDetail = {
  avatarUrl?: string;
  nickname?: string;
  username?: string;
  phone?: string;
};

export function notifyMeUpdated(detail?: MeUpdatedDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<MeUpdatedDetail>("qchat:me-updated", { detail }));
}

/** Notify the mounted chat shell to reload the conversation list (e.g. after group create). */
export type ConversationsChangedDetail = {
  selectId?: string;
};

export function notifyConversationsChanged(detail?: ConversationsChangedDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ConversationsChangedDetail>("qchat:conversations-changed", { detail })
  );
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

export type UploadProgressFn = (loaded: number, total: number) => void;

type MediaUploadResult = {
  id: string;
  url: string;
  content_type: string;
  size: number;
  kind: string;
};

/**
 * Upload via XHR so the File streams from disk (avoids fetch+FormData main-thread stalls)
 * and so callers get upload progress for large media. Pass AbortSignal to cancel mid-upload.
 */
export async function uploadMedia(
  file: Blob,
  kind: string,
  filename: string,
  onProgress?: UploadProgressFn,
  signal?: AbortSignal
): Promise<MediaUploadResult> {
  await ensureAccessToken();
  if (signal?.aborted) {
    throw new ApiError(0, "upload aborted", null);
  }
  const form = new FormData();
  form.append("file", file, filename);
  form.append("kind", kind);

  const doUpload = (retried: boolean) =>
    new Promise<MediaUploadResult>((resolve, reject) => {
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
        let body: unknown = null;
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
              if (!getToken()) {
                redirectLogin();
              }
              reject(new ApiError(401, "unauthorized", body));
            })
            .catch(reject);
          return;
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          let msg = `upload failed (${xhr.status})`;
          if (xhr.status === 413) {
            msg = "File too large";
          } else if (typeof body === "object" && body && "error" in body) {
            const e = String((body as { error?: string }).error || "").trim();
            if (e) msg = e;
          }
          reject(new ApiError(xhr.status, msg, body));
          return;
        }
        resolve(body as MediaUploadResult);
      };

      xhr.onerror = () => {
        cleanup();
        reject(new ApiError(0, "network error", null));
      };
      xhr.onabort = () => {
        cleanup();
        reject(new ApiError(0, "upload aborted", null));
      };
      // Let the browser stream the File; do not read it into an ArrayBuffer first.
      xhr.send(form);
    });

  return doUpload(false);
}
