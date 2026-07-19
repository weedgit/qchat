"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api, clearToken, getToken } from "@/lib/api";

const NAV = [
  { href: "/", label: "Chats", icon: "\u{1F4AC}" },
  { href: "/friends", label: "Friends", icon: "\u{1F465}" },
  { href: "/groups", label: "Groups", icon: "\u{1F3E2}" },
  { href: "/profile", label: "Profile", icon: "\u{1F464}" },
];

export default function AppShell({
  children,
  rail = true,
}: {
  children: React.ReactNode;
  rail?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  async function logout() {
    try {
      await api("/v1/auth/logout", { method: "POST" });
    } catch {
      /* ignore network errors on logout */
    }
    clearToken();
    router.replace("/login");
  }

  return (
    <div className="shell">
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
