"use client";

import { LocaleProvider } from "@/lib/locale";

export function Providers({ children }: { children: React.ReactNode }) {
  return <LocaleProvider>{children}</LocaleProvider>;
}
