"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ChatPageInner from "./ChatPageInner";
import LoadingSplash from "@/components/LoadingSplash";
import { getToken } from "@/lib/api";

/**
 * Auth gate before chat UI.
 * Avoid Suspense+useSearchParams on the root page — that stays on a loading
 * fallback forever in Electron/static export when the client bundle is slow or fails.
 */
export default function ChatPage() {
  const router = useRouter();
  const [state, setState] = useState<"checking" | "ready">("checking");

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    setState("ready");
  }, [router]);

  if (state !== "ready") {
    return <LoadingSplash />;
  }

  return <ChatPageInner />;
}
