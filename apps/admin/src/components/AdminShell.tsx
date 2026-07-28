"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api, clearToken, getToken } from "@/lib/api";
import { can, isConsoleRole } from "@/lib/rbac";

const NAV = [
  { href: "/", label: "Overview", cap: "read" as const },
  { href: "/users", label: "Users", cap: "read" as const },
  { href: "/groups", label: "Groups", cap: "read" as const },
  { href: "/enterprises", label: "Enterprises", cap: "read" as const },
  { href: "/audits", label: "Audit log", cap: "read" as const },
  { href: "/messages", label: "Message inspect", cap: "inspectMessages" as const },
  { href: "/security", label: "Security", cap: "read" as const },
];

export default function AdminShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [role, setRole] = useState<string>("");
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
        setReady(true);
      })
      .catch(() => {
        clearToken();
        router.replace("/login");
      });
  }, [router]);

  const navItems = ready ? NAV.filter((item) => can(role, item.cap)) : NAV;

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar" aria-label="Admin navigation">
        <div className="admin-brand">
          <span className="logo">Q</span>
          <span className="admin-brand-text">Qchat Admin</span>
        </div>
        <div className="admin-nav-label">Menu</div>
        <nav className="admin-nav">
          {navItems.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/" || pathname === ""
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`admin-nav-item ${active ? "active" : ""} ${
                  ready ? "" : "is-loading"
                }`}
                aria-current={active ? "page" : undefined}
              >
                <span className="admin-nav-item-label">{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="spacer" />
        {role ? (
          <div className="admin-nav-item muted admin-role" style={{ cursor: "default" }}>
            <span className="admin-nav-item-label">{role}</span>
          </div>
        ) : (
          <div className="admin-nav-item muted" style={{ cursor: "default" }}>
            <span className="admin-nav-item-label">Loading…</span>
          </div>
        )}
        <button
          type="button"
          className="admin-nav-item"
          onClick={() => {
            clearToken();
            router.replace("/login");
          }}
        >
          <span className="admin-nav-item-label">Log out</span>
        </button>
      </aside>
      <main className="admin-main">{children}</main>
    </div>
  );
}
