import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, clearToken, getToken, initTokens, setOnUnauthorized, setSessionRevokedReason, setTokens } from "../lib/api";
import { getAuthDevice } from "../lib/device";
import { notificationPort } from "../lib/notifyPort";
import type { CurrentUser, PresenceStatus } from "../lib/types";

type AuthContextValue = {
  ready: boolean;
  user: CurrentUser | null;
  signedIn: boolean;
  refreshMe: () => Promise<void>;
  setMyStatus: (status: PresenceStatus) => Promise<void>;
  signIn: (access: string, refresh: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Clear local session without calling logout (remote revoke / kick). */
  forceLocalSignOut: (reason?: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function parseStatus(raw: unknown): PresenceStatus | undefined {
  const s = String(raw ?? "");
  if (s === "online" || s === "away" || s === "dnd" || s === "offline") return s;
  return undefined;
}

function mapMe(u: any): CurrentUser {
  return {
    id: String(u?.id ?? ""),
    phone: String(u?.phone ?? ""),
    username: String(u?.username ?? ""),
    nickname: String(u?.display_name ?? u?.username ?? "Me"),
    avatarUrl: u?.avatar_url || undefined,
    realName: String(u?.real_name ?? "") || undefined,
    age: typeof u?.age === "number" ? u.age : null,
    region: String(u?.region ?? "") || undefined,
    signature: String(u?.signature ?? "") || undefined,
    profileVisibility: String(u?.profile_visibility ?? "friends"),
    friendPrivacy: String(u?.friend_privacy ?? "approval"),
    enterpriseId: String(u?.enterprise_id ?? "").trim() || undefined,
    enterpriseName: String(u?.enterprise_name ?? "").trim() || undefined,
    status: parseStatus(u?.status) ?? "online",
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<CurrentUser | null>(null);

  const refreshMe = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      return;
    }
    const u = await api<any>("/v1/me");
    setUser(mapMe(u));
  }, []);

  const setMyStatus = useCallback(async (status: PresenceStatus) => {
    await api("/v1/me/status", {
      method: "PUT",
      body: JSON.stringify({ status }),
    });
    setUser((prev) => (prev ? { ...prev, status } : prev));
  }, []);

  const signIn = useCallback(async (access: string, refresh: string) => {
    await setTokens(access, refresh);
    await refreshMe();
    void notificationPort.registerRemote().catch(() => {});
  }, [refreshMe]);

  const signOut = useCallback(async () => {
    await notificationPort.unregisterRemote().catch(() => {});
    await api("/v1/auth/logout", { method: "POST" }).catch(() => {});
    await clearToken();
    setUser(null);
  }, []);

  const forceLocalSignOut = useCallback(async (reason?: string) => {
    await notificationPort.unregisterRemote().catch(() => {});
    if (reason) {
      await setSessionRevokedReason(reason).catch(() => {});
    }
    await clearToken();
    setUser(null);
  }, []);

  useEffect(() => {
    setOnUnauthorized(() => {
      setUser(null);
    });
    (async () => {
      await initTokens();
      if (getToken()) {
        try {
          await refreshMe();
        } catch {
          await clearToken();
          setUser(null);
        }
      }
      setReady(true);
    })();
    return () => setOnUnauthorized(null);
  }, [refreshMe]);

  const value = useMemo(
    () => ({
      ready,
      user,
      signedIn: Boolean(user),
      refreshMe,
      setMyStatus,
      signIn,
      signOut,
      forceLocalSignOut,
    }),
    [ready, user, refreshMe, setMyStatus, signIn, signOut, forceLocalSignOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}

export { getAuthDevice };
