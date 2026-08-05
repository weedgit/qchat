"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/locale";
import {
  detectDownloadOs,
  downloadHref,
  FALLBACK_DOWNLOAD_MANIFEST,
  formatBytes,
  isElectronShell,
  loadDownloadManifest,
  pickRecommended,
  type DownloadApp,
  type DownloadManifest,
  type DownloadOs,
} from "@/lib/downloads";
import { APP_NAME, withBasePath } from "@/lib/brand";
import { PlatformSupportBlock } from "@/components/SupportContact";

function PlatformIcon({ os }: { os: DownloadOs }) {
  const common = {
    width: 28,
    height: 28,
    viewBox: "0 0 24 24",
    fill: "currentColor",
    "aria-hidden": true as const,
  };
  switch (os) {
    case "windows":
      return (
        <svg {...common}>
          <path d="M3 5.5 10.2 4.4v6.4H3V5.5zm0 13 7.2 1.1v-6.5H3v5.4zM11.4 4.2 21 2.8v8H11.4V4.2zm0 16.9L21 19.7v-8h-9.6v9.4z" />
        </svg>
      );
    case "macos":
    case "ios":
      return (
            <svg {...common}>
          <path d="M18.7 17.1c-.5 1.1-.7 1.6-1.4 2.6-.9 1.3-2.1 2.9-3.7 2.9-1.4 0-1.8-.9-3.4-.9-1.6 0-2.1.9-3.4.9-1.5 0-2.7-1.5-3.6-2.8C1.7 17.5.6 13.8 2.1 11c.8-1.4 2.1-2.3 3.5-2.3 1.4 0 2.3.9 3.4.9 1.1 0 2.1-1 3.6-1 1.2 0 2.4.6 3.2 1.7-2.8 1.5-2.3 5.5.9 6.8zM14.4 4.9c.6-.8 1.1-1.8.9-2.9-1 .1-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.8 1.1.1 2.2-.5 2.9-1.4z" />
        </svg>
      );
    case "linux":
      return (
        <svg {...common}>
          <path d="M12.1 2.2c-.9 0-2.2 1.1-2.5 3.2-.2 1.3.1 2.7.6 3.7l-.7 1.9c-.8.3-2.7 1.1-2.7 3.3 0 1.4.7 2.4 1.6 3 .4 1.7 1.5 3.3 3.1 3.3.7 0 1.2-.3 1.8-.3.6 0 1.2.3 1.9.3 1.7 0 2.9-1.8 3.3-3.5.8-.5 1.4-1.5 1.4-2.8 0-2.3-2-3-2.8-3.3l-.8-1.9c.6-1.2.9-2.5.7-3.7-.3-2-1.5-3.2-2.5-3.2h-.4z" />
        </svg>
      );
    case "android":
      return (
        <svg {...common}>
          <path d="M17.6 9.5 19.2 6.7a.6.6 0 0 0-.2-.8.6.6 0 0 0-.8.2l-1.6 2.7a9.4 9.4 0 0 0-8.2 0L6.8 6.1a.6.6 0 1 0-1 .6L7.4 9.5A8.2 8.2 0 0 0 4 16.2v.6h16v-.6a8.2 8.2 0 0 0-2.4-6.7zM9.2 13.6a.8.8 0 1 1 0-1.6.8.8 0 0 1 0 1.6zm5.6 0a.8.8 0 1 1 0-1.6.8.8 0 0 1 0 1.6zM6 18h2.2v2.4A1.2 1.2 0 0 1 7 21.6 1.2 1.2 0 0 1 5.8 20.4V18H6zm10 0h2.2v2.4a1.2 1.2 0 0 1-2.4 0V18z" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H13l2 2.5v.5H9v-.5L11 16H5.5A1.5 1.5 0 0 1 4 14.5v-9z" />
        </svg>
      );
  }
}

function AppCard({
  app,
  recommended,
  getLabel,
  soonLabel,
  recommendedLabel,
  delayMs = 0,
}: {
  app: DownloadApp;
  recommended?: boolean;
  getLabel: string;
  soonLabel: string;
  recommendedLabel: string;
  delayMs?: number;
}) {
  const href = downloadHref(app);
  const size = formatBytes(app.sizeBytes);
  const ready = Boolean(href);

  return (
    <article
      className={`dl-card dl-reveal${recommended ? " is-recommended" : ""}${ready ? "" : " is-soon"}`}
      style={{ ["--dl-delay" as string]: `${delayMs}ms` }}
    >
      <div className="dl-card-icon" data-os={app.os}>
        <PlatformIcon os={app.os} />
      </div>
      <div className="dl-card-body">
        <div className="dl-card-title-row">
          <h3>{app.title}</h3>
          {recommended && <span className="dl-pill">{recommendedLabel}</span>}
        </div>
        <p className="dl-card-sub">{app.subtitle}</p>
        {size && <p className="dl-card-meta">{size}</p>}
      </div>
      {ready ? (
        <a className="dl-card-btn" href={href!} download={app.file || undefined}>
          {getLabel}
        </a>
      ) : (
        <span className="dl-card-btn is-disabled">{soonLabel}</span>
      )}
    </article>
  );
}

export default function DownloadPage() {
  const router = useRouter();
  const { t } = useLocale();
  const [os, setOs] = useState<DownloadOs>("unknown");
  const [manifest, setManifest] = useState<DownloadManifest>(FALLBACK_DOWNLOAD_MANIFEST);
  const [error, setError] = useState<string | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    document.documentElement.classList.add("dl-route");
    return () => {
      document.documentElement.classList.remove("dl-route");
    };
  }, []);

  useEffect(() => {
    const root = pageRef.current;
    if (!root) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const nodes = Array.from(root.querySelectorAll<HTMLElement>(".dl-reveal"));
    if (reduce) {
      nodes.forEach((el) => el.classList.add("is-in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-in");
          io.unobserve(entry.target);
        }
      },
      { root, rootMargin: "0px 0px -8% 0px", threshold: 0.12 }
    );
    nodes.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [manifest]);

  useEffect(() => {
    if (isElectronShell()) {
      router.replace("/login");
      return;
    }
    setOs(detectDownloadOs());
    let cancelled = false;
    (async () => {
      try {
        const data = await loadDownloadManifest();
        if (!cancelled) {
          setManifest(data);
          setError(null);
        }
      } catch {
        // Keep fallback cards visible; only surface a soft error.
        if (!cancelled) setError("load-error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const apps = manifest.apps ?? [];
  const recommended = useMemo(() => pickRecommended(apps, os), [apps, os]);
  const desktop = apps.filter((a) => a.group === "desktop");
  const mobile = apps.filter((a) => a.group === "mobile");
  const primaryHref = recommended ? downloadHref(recommended) : null;

  function scrollToId(id: string) {
    const target = document.getElementById(id);
    const root = pageRef.current;
    if (!target || !root) return;
    const top =
      target.getBoundingClientRect().top -
      root.getBoundingClientRect().top +
      root.scrollTop -
      16;
    root.scrollTo({ top, behavior: "smooth" });
  }

  return (
    <div className="dl-page" ref={pageRef}>
      <div className="dl-bg" aria-hidden />
      <header className="dl-top">
        <Link href="/login" className="dl-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={withBasePath("/icons/icon-192.png")} alt="" width={36} height={36} />
          <span>{APP_NAME}</span>
        </Link>
        <nav className="dl-top-nav">
          <Link href="/login" className="dl-link-quiet">
            {t("download.signIn")}
          </Link>
          <Link href="/login" className="dl-btn-ghost">
            {t("download.createAccount")}
          </Link>
        </nav>
      </header>

      <main className="dl-main">
        <section className="dl-hero">
          <div className="dl-hero-copy">
            <p className="dl-eyebrow">{t("download.eyebrow")}</p>
            <h1>{t("download.title")}</h1>
            <p className="dl-lead">{t("download.lead")}</p>
            <div className="dl-hero-actions">
              {primaryHref && recommended ? (
                <a
                  className="dl-btn-primary"
                  href={primaryHref}
                  download={recommended.file || undefined}
                >
                  {t("download.forPlatform", { platform: recommended.title })}
                </a>
              ) : (
                <button
                  type="button"
                  className="dl-btn-primary"
                  onClick={() => scrollToId("desktop")}
                >
                  {t("download.browseAll")}
                </button>
              )}
              <button
                type="button"
                className="dl-btn-secondary"
                onClick={() => scrollToId("mobile")}
              >
                {t("download.mobileCta")}
              </button>
            </div>
            {manifest.version && (
              <p className="dl-version">
                {t("download.version", { version: manifest.version })}
                {manifest.updatedAt ? ` · ${manifest.updatedAt}` : ""}
              </p>
            )}
          </div>
          <div className="dl-hero-art">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={withBasePath("/downloads/images/download-hero.png")}
              alt=""
              width={960}
              height={540}
            />
          </div>
        </section>

        {error && <div className="dl-banner-error">{t("download.loadError")}</div>}

        <section className="dl-section" id="desktop">
          <div className="dl-section-head dl-reveal">
            <div>
              <h2>{t("download.desktopTitle")}</h2>
              <p>{t("download.desktopLead")}</p>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="dl-section-art"
              src={withBasePath("/downloads/images/download-desktop.png")}
              alt=""
              width={320}
              height={240}
            />
          </div>
          <div className="dl-grid">
            {desktop.map((app, i) => (
              <AppCard
                key={app.id}
                app={app}
                recommended={recommended?.id === app.id}
                getLabel={t("download.get")}
                soonLabel={t("download.comingSoon")}
                recommendedLabel={t("download.recommended")}
                delayMs={80 + i * 70}
              />
            ))}
          </div>
        </section>

        <section className="dl-section" id="mobile">
          <div className="dl-section-head dl-reveal">
            <div>
              <h2>{t("download.mobileTitle")}</h2>
              <p>{t("download.mobileLead")}</p>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="dl-section-art dl-section-art-phone"
              src={withBasePath("/downloads/images/download-mobile.png")}
              alt=""
              width={220}
              height={293}
            />
          </div>
          <div className="dl-grid">
            {mobile.map((app, i) => (
              <AppCard
                key={app.id}
                app={app}
                recommended={recommended?.id === app.id}
                getLabel={t("download.get")}
                soonLabel={t("download.comingSoon")}
                recommendedLabel={t("download.recommended")}
                delayMs={80 + i * 70}
              />
            ))}
          </div>
        </section>

        <section className="dl-web-note dl-reveal">
          <div className="dl-web-note-inner">
            <h2>{t("download.webTitle")}</h2>
            <p>{t("download.webLead")}</p>
            <Link href="/login" className="dl-btn-primary">
              {t("download.openWeb")}
            </Link>
          </div>
        </section>

        <PlatformSupportBlock t={t} className="dl-support" />
      </main>

      <footer className="dl-foot">
        <span>© {APP_NAME}</span>
        <Link href="/login">{t("download.backToLogin")}</Link>
      </footer>
    </div>
  );
}
