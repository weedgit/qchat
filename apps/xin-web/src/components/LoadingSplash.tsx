"use client";

import { APP_LOGO_LETTER } from "@/lib/brand";

/** Full-viewport boot splash — matches auth logo, not a bare "Loading…" string. */
export default function LoadingSplash({ label = "Starting XinChat" }: { label?: string }) {
  return (
    <div className="boot-splash" role="status" aria-live="polite" aria-busy="true">
      <div className="boot-splash-mark" aria-hidden>
        <span className="boot-splash-letter">{APP_LOGO_LETTER}</span>
        <span className="boot-splash-ring" />
      </div>
      <div className="boot-splash-brand">XinChat</div>
      <div className="boot-splash-label">
        <span className="boot-splash-dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span>{label}</span>
      </div>
    </div>
  );
}
