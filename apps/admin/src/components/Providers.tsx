"use client";

import { LocaleProvider } from "@/lib/locale";
import { AdminThemeProvider } from "@/lib/AdminThemeContext";
import { ToastProvider } from "@/components/Toast";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <LocaleProvider>
      <AdminThemeProvider>
        <ToastProvider>{children}</ToastProvider>
      </AdminThemeProvider>
    </LocaleProvider>
  );
}
