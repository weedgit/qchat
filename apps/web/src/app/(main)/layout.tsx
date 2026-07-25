"use client";

import { ReactNode } from "react";
import ChatPage from "@/components/ChatPage";

/**
 * Keeps the chat mounted while menu routes (settings, profile, …) render as overlays.
 * Avoids Next.js parallel/intercepting-route soft-nav crashes.
 */
export default function MainLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ChatPage />
      {children}
    </>
  );
}
