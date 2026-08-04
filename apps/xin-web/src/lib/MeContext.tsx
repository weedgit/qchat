"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, getToken } from "@/lib/api";
import type { CurrentUser } from "@/lib/types";

type MeContextValue = {
  me: CurrentUser | null;
  refreshMe: () => Promise<void>;
  patchMe: (partial: Partial<CurrentUser>) => void;
  setMe: (next: CurrentUser | null) => void;
};

const MeContext = createContext<MeContextValue | null>(null);

function userFromApi(u: any): CurrentUser {
  const enterpriseId = String(u?.enterprise_id ?? "").trim();
  const enterpriseName = String(u?.enterprise_name ?? "").trim();
  return {
    id: String(u?.id ?? ""),
    phone: String(u?.phone ?? ""),
    username: String(u?.username ?? ""),
    nickname: String(u?.display_name ?? u?.username ?? "Me"),
    avatarUrl: u?.avatar_url || undefined,
    enterpriseId: enterpriseId || undefined,
    enterpriseName: enterpriseName || undefined,
  };
}

export function MeProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<CurrentUser | null>(null);

  const refreshMe = useCallback(async () => {
    if (!getToken()) return;
    try {
      const u = await api<any>("/v1/me");
      setMe(userFromApi(u));
    } catch {
      /* keep prior profile on transient failure */
    }
  }, []);

  const patchMe = useCallback((partial: Partial<CurrentUser>) => {
    setMe((prev) => (prev ? { ...prev, ...partial } : prev));
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    void refreshMe();
  }, [refreshMe]);

  const value = useMemo(
    () => ({ me, refreshMe, patchMe, setMe }),
    [me, refreshMe, patchMe]
  );

  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}

export function useMe(): MeContextValue {
  const ctx = useContext(MeContext);
  if (!ctx) {
    throw new Error("useMe must be used within MeProvider");
  }
  return ctx;
}
