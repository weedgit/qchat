"use client";

import { Suspense } from "react";
import ChatPageInner from "./ChatPageInner";

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="shell"><div className="empty-state">Loading…</div></div>}>
      <ChatPageInner />
    </Suspense>
  );
}
