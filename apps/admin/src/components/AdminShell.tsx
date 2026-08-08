"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api, clearToken, getToken } from "@/lib/api";
import LanguageSelect from "@/components/LanguageSelect";
import ThemeSelect from "@/components/ThemeSelect";
import { AdminNavIcon, NAV_ICON_BY_HREF } from "@/components/AdminNavIcon";
import { translateRole } from "@/lib/labels";
import { useLocale } from "@/lib/locale";
import { can, isConsoleRole } from "@/lib/rbac";
import type { MessageKey } from "@qchat/i18n";

const NAV: { href: string; labelKey: MessageKey; cap: Parameters<typeof can>[1] }[] = [
  { href: "/", labelKey: "admin.nav.overview", cap: "read" },
  { href: "/users", labelKey: "admin.nav.users", cap: "read" },
  { href: "/groups", labelKey: "admin.nav.groups", cap: "read" },
  { href: "/enterprises", labelKey: "admin.nav.enterprises", cap: "read" },
  { href: "/audits", labelKey: "admin.nav.audits", cap: "read" },
  { href: "/messages", labelKey: "admin.nav.messages", cap: "inspectMessages" },
  { href: "/security", labelKey: "admin.nav.security", cap: "read" },
  { href: "/backup", labelKey: "admin.nav.backup", cap: "manageBackup" },
];

function profileInitial(name: string, username: string): string {
  const src = (name || username || "?").trim();
  return src.charAt(0).toUpperCase();
}

function pageTitleForPath(
  pathname: string,
  navItems: typeof NAV,
  t: (key: MessageKey) => string
): string {
  if (pathname === "/profile" || pathname.startsWith("/profile/")) {
    return t("admin.nav.profile");
  }
  const item = navItems.find((n) =>
    n.href === "/"
      ? pathname === "/" || pathname === ""
      : pathname === n.href || pathname.startsWith(`${n.href}/`)
  );
  return item ? t(item.labelKey) : t("admin.brand");
}

export default function AdminShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useLocale();
  const [role, setRole] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    api<any>("/v1/me")
      .then((me) => {
        const r = String(me?.role ?? "");
        if (!isConsoleRole(r)) {
          clearToken();
          router.replace("/login");
          return;
        }
        setRole(r);
        setDisplayName(String(me?.display_name ?? ""));
        setUsername(String(me?.username ?? ""));
        setReady(true);
      })
      .catch(() => {
        clearToken();
        router.replace("/login");
      });
  }, [router]);

  const navItems = ready ? NAV.filter((item) => can(role, item.cap)) : NAV;
  const roleLabel = role ? translateRole(t, role) : "";
  const profileActive = pathname === "/profile" || pathname.startsWith("/profile/");
  const pageTitle = pageTitleForPath(pathname, navItems, t);

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar" aria-label="Admin navigation">
        <div className="admin-brand">
          <span className="logo">R</span>
          <span className="admin-brand-text">{t("admin.brand")}</span>
        </div>
        <nav className="admin-nav">
          {navItems.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/" || pathname === ""
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            const icon = NAV_ICON_BY_HREF[item.href] ?? "overview";
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`admin-nav-item ${active ? "active" : ""} ${
                  ready ? "" : "is-loading"
                }`}
                aria-current={active ? "page" : undefined}
              >
                <span className="admin-nav-icon" aria-hidden>
                  <AdminNavIcon name={icon} />
                </span>
                <span className="admin-nav-item-label">{t(item.labelKey)}</span>
              </Link>
            );
          })}
        </nav>
        <div className="spacer" />
        <div className="admin-sidebar-tools">
          <ThemeSelect />
          <LanguageSelect className="admin-locale" />
        </div>
        {role ? (
          <Link
            href="/profile"
            className={`admin-profile ${profileActive ? "active" : ""}`}
            aria-current={profileActive ? "page" : undefined}
          >
            <span className="admin-profile-avatar" aria-hidden>
              {profileInitial(displayName, username)}
            </span>
            <span className="admin-profile-meta">
              <span className="admin-profile-name">
                {displayName || username || t("admin.nav.profile")}
              </span>
              <span className="admin-profile-role">{roleLabel}</span>
            </span>
          </Link>
        ) : (
          <div className="admin-role is-loading">{t("admin.loading")}</div>
        )}
        <button
          type="button"
          className="admin-nav-item admin-logout"
          onClick={() => {
            clearToken();
            router.replace("/login");
          }}
        >
          <span className="admin-nav-icon" aria-hidden>
            <AdminNavIcon name="security" />
          </span>
          <span className="admin-nav-item-label">{t("admin.logOut")}</span>
        </button>
      </aside>
      <div className="admin-content">
        <header className="admin-topbar">
          <h1 className="admin-page-title">{pageTitle}</h1>
        </header>
        <main className="admin-main">{children}</main>
      </div>
    </div>
  );
}
