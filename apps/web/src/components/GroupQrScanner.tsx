"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseGroupJoinPayload } from "@/lib/groupQr";
import { parseUserPayload } from "@/lib/userQr";
import { useLocale } from "@/lib/locale";

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

function getBarcodeDetector(): (new (opts?: { formats: string[] }) => BarcodeDetectorLike) | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { BarcodeDetector?: new (opts?: { formats: string[] }) => BarcodeDetectorLike })
    .BarcodeDetector ?? null;
}

type Props = {
  /** Raw QR payload (group invite or user profile). */
  onDetected: (raw: string) => void;
  onClose: () => void;
};

/** Live camera QR scan (Chromium BarcodeDetector; paste fallback elsewhere). */
export default function GroupQrScanner({ onDetected, onClose }: Props) {
  const { t } = useLocale();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const handledRef = useRef(false);
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    const v = videoRef.current;
    if (v) v.srcObject = null;
  }, []);

  useEffect(() => {
    handledRef.current = false;
    let cancelled = false;

    async function start() {
      const Detector = getBarcodeDetector();
      if (!Detector) {
        setError(t("groups.scanUnsupported"));
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(t("groups.scanUnsupported"));
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" } },
        });
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        const detector = new Detector({ formats: ["qr_code"] });
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          setError(t("groups.scanUnsupported"));
          return;
        }

        const tick = async () => {
          if (cancelled || handledRef.current) return;
          const v = videoRef.current;
          if (v && v.readyState >= 2) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            if (canvas.width > 0 && canvas.height > 0) {
              ctx.drawImage(v, 0, 0);
              try {
                const codes = await detector.detect(canvas);
                for (const code of codes) {
                  const raw = String(code.rawValue ?? "").trim();
                  if (!raw) continue;
                  if (parseGroupJoinPayload(raw) || parseUserPayload(raw)) {
                    handledRef.current = true;
                    stop();
                    onDetectedRef.current(raw);
                    return;
                  }
                }
              } catch {
                /* keep scanning */
              }
            }
          }
          rafRef.current = requestAnimationFrame(() => {
            void tick();
          });
        };
        rafRef.current = requestAnimationFrame(() => {
          void tick();
        });
      } catch {
        if (!cancelled) setError(t("groups.scanPermission"));
      }
    }

    void start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [stop, t]);

  return (
    <div className="group-qr-scanner" role="dialog" aria-label={t("groups.scanTitle")}>
      <div className="group-qr-scanner-bar">
        <span>{t("groups.scanTitle")}</span>
        <button type="button" className="btn-ghost" onClick={() => { stop(); onClose(); }}>
          {t("chat.close")}
        </button>
      </div>
      {error ? (
        <div className="menu-modal-error">{error}</div>
      ) : (
        <video ref={videoRef} className="group-qr-scanner-video" playsInline muted />
      )}
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        {t("groups.scanHint")}
      </div>
    </div>
  );
}

export function isGroupQrCameraSupported(): boolean {
  return typeof window !== "undefined" && !!getBarcodeDetector() && !!navigator.mediaDevices?.getUserMedia;
}
