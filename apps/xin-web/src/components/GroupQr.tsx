"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { encodeGroupJoinPayload } from "@/lib/groupQr";

type Props = {
  publicId: string;
  size?: number;
  className?: string;
};

/** Renders a QR for group join (client-side; join still uses POST /v1/groups/join). */
export default function GroupQr({ publicId, size = 160, className }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const payload = encodeGroupJoinPayload(publicId);

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

  if (!publicId || !dataUrl) return null;

  return (
    <div className={className} style={{ textAlign: "center" }}>
      <img
        src={dataUrl}
        alt={`QR code to join group ${publicId}`}
        width={size}
        height={size}
        style={{ borderRadius: 8, background: "#fff" }}
      />
    </div>
  );
}
