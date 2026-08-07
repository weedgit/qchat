"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/locale";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mq = window.matchMedia?.("(display-mode: standalone)")?.matches;
  const ios = Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return Boolean(mq || ios);
}

function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const webkit = /WebKit/.test(ua);
  const chrome = /CriOS|FxiOS|EdgiOS|OPiOS|Chrome/.test(ua);
  return iOS && webkit && !chrome;
}

function isElectronShell(): boolean {
  return typeof window !== "undefined" && Boolean((window as any).qchatDesktop);
}

const DISMISS_KEY = "qchat.pwaInstallDismissed";
const RESHOW_EVENT = "qchat:pwa-install-reshow";

/**
 * PWA install UI — shown only when the user opens it from Settings (not on first visit).
 * Still captures beforeinstallprompt so Settings → Install can trigger the browser dialog.
 */
export default function PwaInstallPrompt() {
  const { t } = useLocale();
  const deferredRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIos, setShowIos] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isElectronShell() || isStandalone()) return;

    const onBip = (e: Event) => {
      e.preventDefault();
      const ev = e as BeforeInstallPromptEvent;
      deferredRef.current = ev;
      setDeferred(ev);
    };
    window.addEventListener("beforeinstallprompt", onBip);

    const onReshow = () => {
      if (isElectronShell() || isStandalone()) return;
      if (deferredRef.current) {
        setDeferred(deferredRef.current);
        setShowIos(false);
        setVisible(true);
        return;
      }
      if (isIosSafari()) {
        setShowIos(true);
        setVisible(true);
      }
    };
    window.addEventListener(RESHOW_EVENT, onReshow);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener(RESHOW_EVENT, onReshow);
    };
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    setShowIos(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  }, []);

  const install = useCallback(async () => {
    const ev = deferredRef.current ?? deferred;
    if (!ev) return;
    await ev.prompt();
    try {
      await ev.userChoice;
    } catch {
      /* ignore */
    }
    deferredRef.current = null;
    setDeferred(null);
    setVisible(false);
  }, [deferred]);

  if (!visible) return null;

  return (
    <div className="pwa-install-banner" role="dialog" aria-label={t("pwa.installTitle")}>
      <div className="pwa-install-copy">
        <strong>{t("pwa.installTitle")}</strong>
        <span>
          {showIos && !deferred ? t("pwa.installIosHint") : t("pwa.installBody")}
        </span>
      </div>
      <div className="pwa-install-actions">
        {deferred ? (
          <button type="button" className="btn" onClick={() => void install()}>
            {t("pwa.installAction")}
          </button>
        ) : null}
        <button type="button" className="btn ghost" onClick={dismiss}>
          {t("pwa.installDismiss")}
        </button>
      </div>
    </div>
  );
}
