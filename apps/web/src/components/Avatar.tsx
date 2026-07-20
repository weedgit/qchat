"use client";

import { API_URL, getToken } from "@/lib/api";

const PALETTE = [
  "#e17076",
  "#faa774",
  "#a695e7",
  "#7bc862",
  "#6ec9cb",
  "#65aadd",
  "#ee7aae",
];

function resolveURL(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("data:") || url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  const path = url.startsWith("/") ? url : `/${url}`;
  const token = getToken();
  const abs = `${API_URL}${path}`;
  if (path.startsWith("/v1/media/") && token) {
    return `${abs}${abs.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
  }
  return abs;
}

export default function Avatar({
  name,
  url,
  size = 48,
  online,
  showStatus = false,
}: {
  name: string;
  url?: string;
  size?: number;
  online?: boolean;
  showStatus?: boolean;
}) {
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const bg = PALETTE[Math.abs(hash) % PALETTE.length];
  const src = resolveURL(url);
  const dot = Math.max(8, Math.round(size * 0.28));

  return (
    <div
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.42, background: src ? "transparent" : bg }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} width={size} height={size} style={{ objectFit: "cover" }} />
      ) : (
        initial
      )}
      {showStatus && (
        <span
          className={`status-dot ${online ? "on" : ""}`}
          style={{ width: dot, height: dot }}
          title={online ? "Online" : "Offline"}
        />
      )}
    </div>
  );
}
