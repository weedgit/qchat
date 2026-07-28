"use client";

import { useEffect } from "react";
import PwaInstallPrompt from "@/components/PwaInstallPrompt";

/** Keep the single root service worker available for PWA install and Web Push. */
export default function PwaBootstrap() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let cancelled = false;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        if (cancelled) return;
        // Prompt a soft refresh when a new worker is waiting.
        if (reg.waiting) {
          reg.waiting.postMessage({ type: "qchat-skip-waiting" });
        }
        reg.addEventListener("updatefound", () => {
          const worker = reg.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              worker.postMessage({ type: "qchat-skip-waiting" });
            }
          });
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return <PwaInstallPrompt />;
}
