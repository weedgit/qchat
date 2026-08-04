"use client";

import { LocaleProvider } from "@/lib/locale";
import { ToastProvider } from "@/components/Toast";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <LocaleProvider>
      <ToastProvider>{children}</ToastProvider>
    </LocaleProvider>
  );
}
