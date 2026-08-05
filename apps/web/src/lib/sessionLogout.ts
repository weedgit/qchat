/** Voluntary sign-out — suppress misleading session.revoked banners on login. */
const VOLUNTARY_KEY = "qchat.voluntary_logout";
const REVOKED_KEY = "qchat.session_revoked";

export function markVoluntaryLogout(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(VOLUNTARY_KEY, "1");
    sessionStorage.removeItem(REVOKED_KEY);
  } catch {
    /* ignore */
  }
}

export function isVoluntaryLogoutPending(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(VOLUNTARY_KEY) === "1";
  } catch {
    return false;
  }
}

/** Consume voluntary logout flag (login screen). Returns true if user initiated sign-out. */
export function consumeVoluntaryLogout(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const pending = sessionStorage.getItem(VOLUNTARY_KEY) === "1";
    sessionStorage.removeItem(VOLUNTARY_KEY);
    sessionStorage.removeItem(REVOKED_KEY);
    return pending;
  } catch {
    return false;
  }
}

export function clearVoluntaryLogoutPending(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(VOLUNTARY_KEY);
  } catch {
    /* ignore */
  }
}

export function loginPath(): string {
  return "/login";
}

export function isLoginPath(pathname: string): boolean {
  const p = pathname.replace(/\/$/, "");
  return p === "/login" || p.endsWith("/login");
}
