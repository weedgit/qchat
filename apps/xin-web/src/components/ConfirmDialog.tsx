"use client";

import { useEffect, useRef } from "react";
import { useLocale } from "@/lib/locale";

export type ConfirmRequest = {
  title: string;
  message?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
};

type Props = {
  request: ConfirmRequest | null;
  onClose: () => void;
};

/** Centered confirmation dialog replacing the browser's top-docked confirm(). */
export default function ConfirmDialog({ request, onClose }: Props) {
  const { t } = useLocale();
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!request) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [request, onClose]);

  if (!request) return null;

  return (
    <div
      className="confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={request.title}
      onClick={onClose}
    >
      <div className="confirm-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="confirm-title">{request.title}</h2>
        {request.message && <p className="confirm-message">{request.message}</p>}
        <div className="confirm-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`btn ${request.danger ? "btn-danger" : ""}`}
            onClick={() => {
              request.onConfirm();
              onClose();
            }}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
