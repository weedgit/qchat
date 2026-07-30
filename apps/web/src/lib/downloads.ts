/** Catalog of installer builds served from /downloads (web only). */

export type DownloadOs = "windows" | "macos" | "linux" | "android" | "ios" | "unknown";
export type DownloadGroup = "desktop" | "mobile";

export type DownloadApp = {
  id: string;
  group: DownloadGroup;
  os: DownloadOs;
  title: string;
  subtitle: string;
  file?: string | null;
  storeUrl?: string | null;
  sizeBytes?: number | null;
  available: boolean;
};

export type DownloadManifest = {
  version: string;
  updatedAt?: string;
  apps: DownloadApp[];
};

export function detectDownloadOs(): DownloadOs {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent || "";
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } })
    .userAgentData?.platform || navigator.platform || "";

  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Win/i.test(platform) || /Windows/i.test(ua)) return "windows";
  if (/Mac/i.test(platform) || /Mac OS X/i.test(ua)) {
    // iPadOS 13+ may report as Mac — prefer touch points.
    if (navigator.maxTouchPoints > 1) return "ios";
    return "macos";
  }
  if (/Linux/i.test(platform) || /Linux/i.test(ua)) return "linux";
  return "unknown";
}

export function isElectronShell(): boolean {
  return typeof window !== "undefined" && Boolean(window.qchatDesktop);
}

export function downloadHref(app: DownloadApp): string | null {
  if (!app.available) return null;
  if (app.storeUrl) return app.storeUrl;
  if (app.file) return `/downloads/${encodeURIComponent(app.file)}`;
  return null;
}

export function formatBytes(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function pickRecommended(
  apps: DownloadApp[],
  os: DownloadOs
): DownloadApp | null {
  if (os === "unknown") return null;
  const match = apps.filter((a) => a.os === os && a.available && downloadHref(a));
  if (!match.length) return null;
  // Prefer AppImage over deb for generic Linux recommendation.
  if (os === "linux") {
    return match.find((a) => a.id === "linux-appimage") || match[0];
  }
  return match[0];
}

export async function loadDownloadManifest(): Promise<DownloadManifest> {
  const res = await fetch(`/downloads/manifest.json?t=${Date.now()}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`manifest ${res.status}`);
  const data = (await res.json()) as DownloadManifest;
  if (!data || !Array.isArray(data.apps)) {
    throw new Error("invalid manifest");
  }
  return data;
}

/** Static catalog so the page never sits on an empty “Loading…” banner. */
export const FALLBACK_DOWNLOAD_MANIFEST: DownloadManifest = {
  version: "0.1.0",
  updatedAt: undefined,
  apps: [
    {
      id: "windows",
      group: "desktop",
      os: "windows",
      title: "Windows",
      subtitle: "NSIS installer (.exe)",
      file: "qchat-desktop-Setup-0.1.0.exe",
      available: false,
    },
    {
      id: "macos",
      group: "desktop",
      os: "macos",
      title: "macOS",
      subtitle: "Disk image (.dmg, Apple Silicon)",
      file: "qchat-desktop-0.1.0-arm64.dmg",
      available: false,
    },
    {
      id: "linux-appimage",
      group: "desktop",
      os: "linux",
      title: "Linux",
      subtitle: "AppImage (x64)",
      file: "qchat-desktop-0.1.0-x64.AppImage",
      available: false,
    },
    {
      id: "linux-deb",
      group: "desktop",
      os: "linux",
      title: "Debian / Ubuntu",
      subtitle: "Package (.deb)",
      file: "qchat-desktop-0.1.0-amd64.deb",
      available: false,
    },
    {
      id: "android",
      group: "mobile",
      os: "android",
      title: "Android",
      subtitle: "APK install",
      file: "qchat-mobile.apk",
      available: false,
    },
    {
      id: "ios",
      group: "mobile",
      os: "ios",
      title: "iPhone & iPad",
      subtitle: "App Store / TestFlight",
      file: null,
      storeUrl: null,
      available: false,
    },
  ],
};
