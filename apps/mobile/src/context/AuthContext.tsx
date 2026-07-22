import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, clearToken, getToken, initTokens, setOnUnauthorized, setTokens } from "../lib/api";
import { getAuthDevice } from "../lib/device";
import type { CurrentUser } from "../lib/types";

type AuthContextValue = {
  ready: boolean;
  user: CurrentUser | null;
  signedIn: boolean;
  refreshMe: () => Promise<void>;
  signIn: (access: string, refresh: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

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

  const signIn = useCallback(async (access: string, refresh: string) => {
    await setTokens(access, refresh);
    await refreshMe();
  }, [refreshMe]);

  const signOut = useCallback(async () => {
    await api("/v1/auth/logout", { method: "POST" }).catch(() => {});
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
      signIn,
      signOut,
    }),
    [ready, user, refreshMe, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}

export { getAuthDevice };
