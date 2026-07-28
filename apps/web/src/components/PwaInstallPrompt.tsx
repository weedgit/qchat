"use client";

import { useCallback, useEffect, useState } from "react";
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

/**
 * Chromium beforeinstallprompt chip + iOS Add-to-Home-Screen hint.
 * Hidden in Electron and when already installed as a PWA.
 */
export default function PwaInstallPrompt() {
  const { t } = useLocale();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIos, setShowIos] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isElectronShell() || isStandalone()) return;
    try {
      if (localStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      /* ignore */
    }

    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onBip);

    const onReshow = () => {
      if (isElectronShell() || isStandalone()) return;
      if (isIosSafari()) {
        setShowIos(true);
        setVisible(true);
      }
    };
    window.addEventListener("qchat:pwa-install-reshow", onReshow);

    if (isIosSafari()) {
      setShowIos(true);
      setVisible(true);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("qchat:pwa-install-reshow", onReshow);
    };
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    setDeferred(null);
    setShowIos(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return;
    await deferred.prompt();
    try {
      await deferred.userChoice;
    } catch {
      /* ignore */
    }
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
