"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api, clearToken, getToken, restoreDesktopSession } from "@/lib/api";
import { unregisterWebPush } from "@/lib/webPush";

const NAV = [
  { href: "/", label: "Chats", icon: "\u{1F4AC}" },
  { href: "/friends", label: "Friends", icon: "\u{1F465}" },
  { href: "/groups", label: "Groups", icon: "\u{1F3E2}" },
  { href: "/profile", label: "Profile", icon: "\u{1F464}" },
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
 /** Narrow-width list/chat switch (mobile channel view). */
  mobilePane?: "list" | "chat";
  /** Wide layout: hide conversation list (menu bar) while chat stays open. */
  sidebarCollapsed?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();

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
        <nav className="nav-rail">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item ${pathname === item.href ? "active" : ""}`}
              title={item.label}
            >
              <span aria-hidden>{item.icon}</span>
            </Link>
          ))}
          <div className="spacer" />
          <button className="nav-item" title="Log out" onClick={logout}>
            <span aria-hidden>{"\u23FB"}</span>
          </button>
        </nav>
      )}
      {children}
    </div>
  );
}
