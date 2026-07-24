"use client";

import { useEffect, useState } from "react";
import { isQchatDesktop } from "./device";

const THEME_KEY = "qchat.theme";

export type ThemeMode = "dark" | "light" | "system";

export function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  const v = localStorage.getItem(THEME_KEY);
  if (v === "light" || v === "dark" || v === "system") return v;
  return "dark";
}

function resolvedTheme(mode: ThemeMode): "dark" | "light" {
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return mode;
}

export function applyTheme(mode: ThemeMode) {
  const resolved = resolvedTheme(mode);
  document.documentElement.setAttribute("data-theme", resolved);
  document.documentElement.style.colorScheme = resolved;
}

/** SHELL-31: align Electron chrome with the web theme preference (no-op in browser). */
function syncDesktopNativeTheme(mode: ThemeMode) {
  if (!isQchatDesktop()) return;
  const desk = window.qchatDesktop;
  if (!desk?.setNativeThemeSource) return;
  void desk.setNativeThemeSource(mode).catch(() => {});
}

/** Theme preference (dark / light / system), stored locally. */
export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>("dark");

  useEffect(() => {
    const stored = getStoredTheme();
    setThemeState(stored);
    applyTheme(stored);
    syncDesktopNativeTheme(stored);

    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onOsScheme = () => {
      if (getStoredTheme() === "system") applyTheme("system");
    };
    mq.addEventListener("change", onOsScheme);

    let detachDesktop = () => {};
    if (isQchatDesktop() && window.qchatDesktop?.onNativeThemeUpdated) {
      detachDesktop = window.qchatDesktop.onNativeThemeUpdated(onOsScheme);
    }

    return () => {
      mq.removeEventListener("change", onOsScheme);
      detachDesktop();
    };
  }, []);

  function setTheme(next: ThemeMode) {
    localStorage.setItem(THEME_KEY, next);
    setThemeState(next);
    applyTheme(next);
    syncDesktopNativeTheme(next);
  }

  return { theme, setTheme };
}
