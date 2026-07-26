"use client";

import { ReactNode } from "react";
import ChatPage from "@/components/ChatPage";
import { MeProvider } from "@/lib/MeContext";

/**
 * Keeps the chat mounted while menu routes (settings, profile, …) render as overlays.
 * MeProvider shares the signed-in profile so avatar/name edits update the menu immediately.
 */
export default function MainLayout({ children }: { children: ReactNode }) {
  return (
    <MeProvider>
      <ChatPage />
      {children}
    </MeProvider>
  );
}
