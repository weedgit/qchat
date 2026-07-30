/**
 * Human-readable client platform for active-session settings.
 * Examples: "Chrome 131 · Windows 11", "Firefox 128 · Ubuntu 24.04".
 */

export type ClientPlatformInfo = {
  /** Short label stored on the session (browser/OS or app/OS). */
  platform: string;
  browser?: string;
  os?: string;
};

function browserFromUA(ua: string): { name: string; version: string } {
  const take = (re: RegExp, name: string) => {
    const m = ua.match(re);
    return m ? { name, version: m[1] || "" } : null;
  };
  return (
    take(/Edg\/([\d.]+)/i, "Edge") ||
    take(/OPR\/([\d.]+)/i, "Opera") ||
    take(/CriOS\/([\d.]+)/i, "Chrome") ||
    take(/FxiOS\/([\d.]+)/i, "Firefox") ||
    ( /Chrome\//i.test(ua) && !/Chromium/i.test(ua)
      ? take(/Chrome\/([\d.]+)/i, "Chrome")
      : null) ||
    take(/Firefox\/([\d.]+)/i, "Firefox") ||
    ( /Safari\//i.test(ua) && !/Chrome\//i.test(ua)
      ? take(/Version\/([\d.]+)/i, "Safari") || { name: "Safari", version: "" }
      : null) || { name: "Browser", version: "" }
  );
}

function browserLabel(name: string, version: string): string {
  const major = version.split(".")[0];
  if (major) return `${name} ${major}`;
  return name;
}

function windowsLabelFromUA(ua: string): string {
  if (/Windows NT 10\.0/.test(ua)) return "Windows 10";
  if (/Windows NT 6\.3/.test(ua)) return "Windows 8.1";
  if (/Windows NT 6\.1/.test(ua)) return "Windows 7";
  if (/Windows/.test(ua)) return "Windows";
  return "";
}

function osFromUA(ua: string): string {
  const win = windowsLabelFromUA(ua);
  if (win) return win;
  if (/Android/i.test(ua)) {
    const m = ua.match(/Android\s+([\d.]+)/i);
    return m ? `Android ${m[1]}` : "Android";
  }
  if (/iPhone|iPad|iPod/i.test(ua)) {
    const m = ua.match(/OS\s+([\d_]+)/i);
    return m ? `iOS ${m[1].replace(/_/g, ".")}` : "iOS";
  }
  if (/Mac OS X/i.test(ua)) {
    const m = ua.match(/Mac OS X\s+([\d_]+)/i);
    return m ? `macOS ${m[1].replace(/_/g, ".")}` : "macOS";
  }
  if (/CrOS/i.test(ua)) return "ChromeOS";
  if (/Ubuntu/i.test(ua)) {
    const m = ua.match(/Ubuntu[\/\s]?([\d.]+)?/i);
    return m?.[1] ? `Ubuntu ${m[1]}` : "Ubuntu";
  }
  if (/Linux/i.test(ua)) return "Linux";
  return "Unknown OS";
}

async function refineChromiumOS(fallback: string): Promise<string> {
  const nav = typeof navigator !== "undefined" ? (navigator as any) : null;
  const uad = nav?.userAgentData;
  if (!uad?.getHighEntropyValues) return fallback;
  try {
    const hints = await uad.getHighEntropyValues(["platform", "platformVersion"]);
    const platform = String(hints?.platform || "");
    const ver = String(hints?.platformVersion || "");
    if (/Windows/i.test(platform) && ver) {
      const major = parseInt(ver.split(".")[0] || "0", 10);
      if (major >= 13) return "Windows 11";
      if (major > 0) return "Windows 10";
    }
    if (/macOS|Mac OS/i.test(platform) && ver) return `macOS ${ver}`;
    if (/Linux/i.test(platform)) return fallback.startsWith("Ubuntu") ? fallback : "Linux";
  } catch {
    /* hints unavailable */
  }
  return fallback;
}

/** Browser / PWA platform label. */
export async function detectWebPlatform(): Promise<ClientPlatformInfo> {
  if (typeof navigator === "undefined") {
    return { platform: "Web" };
  }
  const ua = navigator.userAgent || "";
  const { name, version } = browserFromUA(ua);
  const browser = browserLabel(name, version);
  let os = osFromUA(ua);
  os = await refineChromiumOS(os);
  return { platform: `${browser} · ${os}`, browser, os };
}

/** Electron desktop platform label from preload bridge. */
export function detectDesktopPlatform(): ClientPlatformInfo {
  const desk = typeof window !== "undefined" ? window.qchatDesktop : undefined;
  const label =
    desk?.platformLabel ||
    desk?.deviceName?.replace(/^Rchat Desktop\s*\(/, "").replace(/^Qchat Desktop\s*\(/, "").replace(/\)$/, "") ||
    desk?.platform ||
    "Desktop";
  return { platform: label, os: label };
}
