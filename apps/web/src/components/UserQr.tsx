"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { encodeUserPayload } from "@/lib/userQr";

type Props = {
  username: string;
  size?: number;
  className?: string;
};

/** Renders a QR for a user profile (`qchat://user/{username}`). */
export default function UserQr({ username, size = 160, className }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const payload = encodeUserPayload(username);

  useEffect(() => {
    if (!payload) {
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(payload, {
      width: size,
      margin: 1,
      color: { dark: "#0e1621", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [payload, size]);

  if (!username || !dataUrl) return null;

  return (
    <div className={className} style={{ textAlign: "center" }}>
      <img
        src={dataUrl}
        alt={`QR code for @${username}`}
        width={size}
        height={size}
        style={{ borderRadius: 8, background: "#fff" }}
      />
    </div>
  );
}
