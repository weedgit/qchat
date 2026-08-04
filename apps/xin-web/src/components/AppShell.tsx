"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { MessageKey } from "@qchat/i18n";
import { api, clearToken, getToken, restoreDesktopSession } from "@/lib/api";
import { APP_LOGO_LETTER } from "@/lib/brand";
import { useLocale } from "@/lib/locale";
import { unregisterWebPush } from "@/lib/webPush";

const NAV: { href: string; labelKey: MessageKey; icon: string }[] = [
  { href: "/", labelKey: "nav.chats", icon: "💬" },
  { href: "/friends", labelKey: "nav.contacts", icon: "👥" },
  { href: "/groups", labelKey: "nav.groups", icon: "🏢" },
  { href: "/profile", labelKey: "nav.me", icon: "👤" },
];

export default function AppShell({
  children,
  rail = true,
  className,
  mobilePane,
  sidebarCollapsed = false,
}: {
  children: React.ReactNode;
  rail?: boolean;
  className?: string;
  mobilePane?: "list" | "chat";
  sidebarCollapsed?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useLocale();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = (await restoreDesktopSession()) || Boolean(getToken());
      if (cancelled) return;
      if (!ok) {
        window.location.replace("/login");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    try {
      await unregisterWebPush();
    } catch {
      /* stale endpoints are pruned after 404/410 */
    }
    await api("/v1/auth/logout", { method: "POST" }).catch(() => {});
    clearToken();
    router.replace("/login");
  }

  return (
    <div
      className={["shell", className].filter(Boolean).join(" ")}
      data-mobile-pane={mobilePane}
      data-sidebar-collapsed={sidebarCollapsed ? "true" : undefined}
    >
      {rail && (
        <nav className="nav-rail xin-nav-rail" aria-label="Main">
          <div className="xin-nav-brand" aria-hidden>{APP_LOGO_LETTER}</div>
          {NAV.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/" || pathname === ""
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-item ${active ? "active" : ""}`}
                title={t(item.labelKey)}
              >
                <span className="nav-icon" aria-hidden>{item.icon}</span>
                <span className="nav-label">{t(item.labelKey)}</span>
              </Link>
            );
          })}
          <div className="spacer" />
          <button
            type="button"
            className="nav-item"
            title={t("nav.signOut")}
            onClick={logout}
          >
            <span className="nav-icon" aria-hidden>⏻</span>
            <span className="nav-label">{t("nav.signOut")}</span>
          </button>
        </nav>
      )}
      {children}
    </div>
  );
}
