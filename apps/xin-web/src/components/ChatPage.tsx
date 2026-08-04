"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ChatPageInner from "@/app/ChatPageInner";
import LoadingSplash from "@/components/LoadingSplash";
import { ensureAccessToken, getToken, restoreDesktopSession } from "@/lib/api";

/**
 * Auth gate + chat UI. Mounted by the (main) layout so it stays under menu overlays
 * (Telegram-style: chat visible behind Settings / Profile / …).
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
