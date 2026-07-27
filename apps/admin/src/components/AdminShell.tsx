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
      })
      .catch(() => {
        clearToken();
        router.replace("/login");
      });
  }, [router]);

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span className="logo">Q</span>
          Qchat Admin
        </div>
        {role
          ? NAV.filter((item) => can(role, item.cap)).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`admin-nav-item ${pathname === item.href ? "active" : ""}`}
              >
                {item.label}
              </Link>
            ))
          : null}
        <div className="spacer" />
        {role ? <div className="admin-nav-item muted" style={{ cursor: "default" }}>{role}</div> : null}
        <button
          className="admin-nav-item"
          onClick={() => {
            clearToken();
            router.replace("/login");
          }}
        >
          Log out
        </button>
      </aside>
      <main className="admin-main">{children}</main>
    </div>
  );
}
