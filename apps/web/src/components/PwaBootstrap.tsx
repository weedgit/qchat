"use client";

import { useEffect } from "react";

/** Keep the single root service worker available for PWA install and Web Push. */
export default function PwaBootstrap() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);

  return null;
}
