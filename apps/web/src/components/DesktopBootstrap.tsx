"use client";

import { useEffect } from "react";
import { isQchatDesktop } from "@/lib/device";

/** Marks <html> when running inside the Electron shell. */
export default function DesktopBootstrap() {
  useEffect(() => {
    if (!isQchatDesktop()) return;
    document.documentElement.dataset.qchatDesktop = "1";
    const desk = window.qchatDesktop;
    if (desk?.platform) {
      document.documentElement.dataset.qchatPlatform = desk.platform;
    }
    desk?.signalReady();
  }, []);
  return null;
}
