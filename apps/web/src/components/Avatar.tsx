"use client";

import { useEffect, useState } from "react";
import { mediaAuthURL } from "@/lib/api";

const PALETTE = [
  "#e17076",
  "#faa774",
  "#a695e7",
  "#7bc862",
  "#6ec9cb",
  "#65aadd",
  "#ee7aae",
];

export default function Avatar({
  name,
  url,
  size = 48,
  online,
  showStatus = false,
  className,
}: {
  name: string;
  url?: string;
  size?: number;
  online?: boolean;
  showStatus?: boolean;
  className?: string;
}) {
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const bg = PALETTE[Math.abs(hash) % PALETTE.length];
  const src = mediaAuthURL(url);
  const [failed, setFailed] = useState(false);
  const showImg = Boolean(src) && !failed;
  const dot = Math.max(8, Math.round(size * 0.28));

  useEffect(() => {
    setFailed(false);
  }, [src]);

  return (
    <div
      className={["avatar", className].filter(Boolean).join(" ")}
      style={{ width: size, height: size, fontSize: size * 0.42, background: showImg ? "transparent" : bg }}
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          src={src}
          alt={name}
          width={size}
          height={size}
          style={{ objectFit: "cover" }}
          onError={() => setFailed(true)}
        />
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
