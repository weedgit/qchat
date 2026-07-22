"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ChatPageInner from "./ChatPageInner";
import LoadingSplash from "@/components/LoadingSplash";
import { ensureAccessToken, getToken, restoreDesktopSession } from "@/lib/api";

/**
 * Auth gate before chat UI.
 * Stay on LoadingSplash ("Starting Qchat") until tokens are restored and usable —
 * never mount chat with a dead session (that flashes Reconnecting → /login).
 */
export default function ChatPage() {
  const router = useRouter();
  const [state, setState] = useState<"checking" | "ready">("checking");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await restoreDesktopSession();
      if (cancelled) return;

      if (!getToken()) {
        router.replace("/login");
        return;
      }

      const ok = await ensureAccessToken();
      if (cancelled) return;

      if (!ok || !getToken()) {
        router.replace("/login");
        return;
      }

      setState("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (state !== "ready") {
    return <LoadingSplash />;
  }

  return <ChatPageInner />;
}
