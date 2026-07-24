"use client";

import { useEffect, useState } from "react";
import { isQchatDesktop } from "@/lib/device";

type Props = {
  /** WebSocket reconnect after a prior successful connect (chat shell). */
  reconnecting?: boolean;
  /**
   * When true, only show the reconnect strip (offline is handled by the
   * layout-level banner so we never stack two offline bars).
   */
  reconnectOnly?: boolean;
};

/**
 * SHELL-32 — dedicated desktop shell banner for OS offline / WS reconnect.
 * No-op in the browser so existing web UX stays unchanged.
 */
export default function ShellConnectionBanner({
  reconnecting = false,
  reconnectOnly = false,
}: Props) {
  const [active, setActive] = useState(false);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    if (!isQchatDesktop()) return;
    setActive(true);

    let cancelled = false;
    const apply = (next: boolean) => {
      if (!cancelled) setOnline(next);
    };

    apply(typeof navigator !== "undefined" ? navigator.onLine : true);

    const desk = window.qchatDesktop;
    if (desk?.getNetworkOnline) {
      void desk
        .getNetworkOnline()
        .then((r) => {
          if (r && typeof r.online === "boolean") apply(r.online);
        })
        .catch(() => {});
    }

    const onOnline = () => apply(true);
    const onOffline = () => apply(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  if (!active) return null;

  if (!reconnectOnly && !online) {
    return (
      <div className="shell-connection-banner offline" role="status" aria-live="polite">
        No internet connection
      </div>
    );
  }

  if (reconnecting && online) {
    return (
      <div className="shell-connection-banner reconnect" role="status" aria-live="polite">
        Reconnecting…
      </div>
    );
  }

  return null;
}
