"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import CallOverlay from "@/components/CallOverlay";
import { getToken, restoreDesktopSession } from "@/lib/api";
import { useCall } from "@/lib/useCall";

/**
 * Telegram-style dedicated video chat window:
 * fullscreen video stage + participant list only (no chat chrome).
 */
export default function CallPopoutPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<"boot" | "ready" | "error">("boot");
  const [bootError, setBootError] = useState<string | null>(null);
  const started = useRef(false);

  const call = useCall({
    isPopoutWindow: true,
    subscribe: () => () => {},
  });

  useEffect(() => {
    document.title = "XinChat Video Chat";
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let cancelled = false;
    (async () => {
      const authed = (await restoreDesktopSession()) || Boolean(getToken());
      if (cancelled) return;
      if (!authed) {
        router.replace("/login");
        return;
      }
      try {
        const ok = await call.resumeFromHandoff();
        if (cancelled) return;
        if (!ok) {
          setBootError("No active video chat to open.");
          setPhase("error");
          return;
        }
        setPhase("ready");
      } catch (e: any) {
        if (cancelled) return;
        setBootError(e?.message || "Could not join video chat");
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === "boot") {
    return (
      <div className="call-overlay call-group-fullscreen call-popout-window">
        <div className="call-popout-loading muted">Opening video chat…</div>
      </div>
    );
  }

  if (phase === "error" && !call.active) {
    return (
      <div className="call-overlay call-group-fullscreen call-popout-window">
        <div className="call-popout-loading">
          <div className="error-text" style={{ marginBottom: 12 }}>
            {bootError}
          </div>
          <button type="button" className="btn" onClick={() => window.close()}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return <CallOverlay call={call} variant="popout" />;
}
