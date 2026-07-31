"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "@/lib/locale";

/** Full-screen image preview opened by clicking a chat image. */
export default function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt?: string;
  onClose: () => void;
}) {
  const { t } = useLocale();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={alt || t("chat.photo")}
      onClick={onClose}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        className="image-lightbox-close icon-btn"
        title={t("chat.close")}
        aria-label={t("chat.close")}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        {"\u2715"}
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt || ""}
        className="image-lightbox-img"
        draggable={false}
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body
  );
}
