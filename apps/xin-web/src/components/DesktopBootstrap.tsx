"use client";

import { useEffect } from "react";
import { isXinchatDesktop } from "@/lib/device";

/** Marks <html> when running inside the Electron shell. */
export default function DesktopBootstrap() {
  useEffect(() => {
    if (!isXinchatDesktop()) return;
    document.documentElement.dataset.xinchatDesktop = "1";
    const desk = window.xinchatDesktop;
    if (desk?.platform) {
      document.documentElement.dataset.qchatPlatform = desk.platform;
    }
    desk?.signalReady();
  }, []);
  return null;
}
