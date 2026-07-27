"use client";

import { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/locale";

/** Shared Telegram-style popup shell for menu pages (profile, settings, …). */
export default function MenuModal({
  title,
  ariaLabel,
  action,
  children,
  onClose,
  backHref = "/",
  overlayClassName,
}: {
  title: string;
  ariaLabel?: string;
  action?: ReactNode;
  children: ReactNode;
  onClose?: () => void;
  backHref?: string;
  /** Extra class on the overlay (e.g. stacked manage window). */
  overlayClassName?: string;
}) {
  const router = useRouter();
  const { t } = useLocale();

  function close() {
    if (onClose) {
      onClose();
      return;
    }
    // (main) layout keeps ChatPage mounted; clearing the overlay route is enough.
    router.push(backHref);
  }

  return (
    <div
      className={`menu-modal-overlay${overlayClassName ? ` ${overlayClassName}` : ""}`}
      role="presentation"
      /* Backdrop clicks must not dismiss — only ✕ / Save close the window. */
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="menu-modal"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel || title}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="menu-modal-bar">
          <button
            type="button"
            className="icon-btn menu-modal-close"
            title={t("chat.close")}
            aria-label={t("chat.close")}
            onClick={close}
          >
            {"\u2715"}
          </button>
          <h1>{title}</h1>
          <div className="menu-modal-action-slot">{action ?? null}</div>
        </header>
        <div className="menu-modal-body">{children}</div>
      </div>
    </div>
  );
}
