"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearToken, getToken } from "@/lib/api";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/users", label: "Users" },
  { href: "/enterprises", label: "Enterprises" },
  { href: "/audits", label: "Audit log" },
  { href: "/messages", label: "Message inspect" },
  { href: "/security", label: "Security" },
];

export default function AdminShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span className="logo">Q</span>
          Qchat Admin
        </div>
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`admin-nav-item ${pathname === item.href ? "active" : ""}`}
          >
            {item.label}
          </Link>
        ))}
        <div className="spacer" />
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
