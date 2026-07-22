"use client";

import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { isQchatDesktop } from "@/lib/device";

export type PresenceStatus = "online" | "away" | "dnd" | "offline";

/**
 * AUTH-04 — when the Electron shell reports idle, set status to away;
 * when activity resumes, restore online. Never overrides DND / offline /
 * manually chosen away.
 */
export function useDesktopIdleStatus(
  myStatus: PresenceStatus,
  setMyStatus: (next: PresenceStatus) => void
) {
  const statusRef = useRef(myStatus);
  statusRef.current = myStatus;
  /** True only when the current away was set by idle auto-bridge. */
  const autoAwayRef = useRef(false);

  useEffect(() => {
    if (!isQchatDesktop()) return;
    const desk = window.qchatDesktop;
    if (!desk?.onUserActivity) return;

    const detach = desk.onUserActivity((payload) => {
      const active = Boolean(payload?.userIsActive);
      const cur = statusRef.current;

      if (!active) {
        if (cur === "online") {
          autoAwayRef.current = true;
          setMyStatus("away");
          void api("/v1/me/status", {
            method: "PUT",
            body: JSON.stringify({ status: "away" }),
          }).catch(() => {});
        }
        return;
      }

      // Active again — only clear auto-away.
      if (autoAwayRef.current && cur === "away") {
        autoAwayRef.current = false;
        setMyStatus("online");
        void api("/v1/me/status", {
          method: "PUT",
          body: JSON.stringify({ status: "online" }),
        }).catch(() => {});
      }
    });

    return detach;
  }, [setMyStatus]);

  /** Call before applying a user-chosen status so idle won't fight it. */
  function noteManualStatusChange(next: PresenceStatus) {
    autoAwayRef.current = false;
    void next;
  }

  return { noteManualStatusChange };
}
