/**
 * API origin for the admin console.
 * - NEXT_PUBLIC_API_URL set (including "") → use it; empty means same-origin (nginx).
 * - unset + browser → same-origin when served at /admin behind nginx; else host:8080 for local dev.
 */
export function apiBaseUrl(): string {
  if (typeof process.env.NEXT_PUBLIC_API_URL === "string") {
    const fromEnv = process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, "");
    if (fromEnv) return fromEnv;
    if (typeof window !== "undefined") return window.location.origin;
    return "";
  }
  if (typeof window !== "undefined") {
    const { protocol, hostname, port, pathname } = window.location;
    // Production: static admin at /admin/* with API proxied on the same host (/v1).
    if (
      pathname.startsWith("/admin") ||
      port === "443" ||
      port === "80" ||
      port === ""
    ) {
      return window.location.origin;
    }
    // Local `next dev -p 3001` without nginx.
    return `${protocol}//${hostname}:8080`;
  }
  return "http://localhost:8080";
}

export const API_URL =
  typeof window !== "undefined" ? apiBaseUrl() : process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

const TOKEN_KEY = "qchat.admin.access_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);
}

/** Absolute media URL with admin access token for <img>/download links. */
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

export function setToken(token: string, remember: boolean) {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  code?: string;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
    const code = (body as { code?: string } | null)?.code;
    if (typeof code === "string" && code) this.code = code;
  }
}

export async function api<T = any>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    ...(init.headers as Record<string, string> | undefined),
  };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "Network error", { code: "network_error" });
  }

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
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

export function asList(body: any, ...keys: string[]): any[] {
  if (Array.isArray(body)) return body;
  for (const k of [...keys, "items", "list", "records", "results"]) {
    if (Array.isArray(body?.[k])) return body[k];
  }
  return [];
}
