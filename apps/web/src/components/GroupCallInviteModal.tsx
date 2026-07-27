"use client";

import { useMemo, useState } from "react";
import Avatar from "@/components/Avatar";
import { useLocale } from "@/lib/locale";

export type GroupCallInviteMember = {
  userId: string;
  displayName: string;
  username?: string;
  avatarUrl?: string;
};

/** Pick group members to invite into a voice/video call. */
export default function GroupCallInviteModal({
  title,
  members,
  excludeIds,
  busy,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  members: GroupCallInviteMember[];
  excludeIds?: string[];
  busy?: boolean;
  confirmLabel: string;
  onConfirm: (userIds: string[]) => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  const exclude = useMemo(() => new Set(excludeIds ?? []), [excludeIds]);
  const candidates = useMemo(
    () => members.filter((m) => m.userId && !exclude.has(m.userId)),
    [members, exclude]
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (m) =>
        m.displayName.toLowerCase().includes(q) ||
        (m.username ?? "").toLowerCase().includes(q)
    );
  }, [candidates, query]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div
      className="forward-modal"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className="forward-modal-card"
        style={{ maxWidth: 400, width: "min(400px, 94vw)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>{title}</h3>
        <input
          className="search-input"
          style={{ width: "100%", marginBottom: 10 }}
          placeholder={t("details.searchUsersPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={busy}
        />
        <div className="group-call-invite-list">
          {filtered.length === 0 ? (
            <div className="muted" style={{ padding: 12, textAlign: "center" }}>
              {t("details.noFriendsLeft")}
            </div>
          ) : (
            filtered.map((m) => {
              const on = selected.has(m.userId);
              return (
                <button
                  key={m.userId}
                  type="button"
                  className={`group-call-invite-row${on ? " is-selected" : ""}`}
                  disabled={busy}
                  onClick={() => toggle(m.userId)}
                >
                  <Avatar name={m.displayName} url={m.avatarUrl} size={36} />
                  <span className="group-call-invite-meta">
                    <span className="group-call-invite-name">{m.displayName}</span>
                    {m.username ? (
                      <span className="muted" style={{ fontSize: 12 }}>
                        @{m.username}
                      </span>
                    ) : null}
                  </span>
                  <span className="group-call-invite-check" aria-hidden>
                    {on ? "✓" : ""}
                  </span>
                </button>
              );
            })
          )}
        </div>
        <div className="forward-modal-actions" style={{ marginTop: 12 }}>
          <button className="btn-ghost" type="button" disabled={busy} onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button
            className="btn"
            type="button"
            disabled={busy || selected.size === 0}
            onClick={() => onConfirm(Array.from(selected))}
          >
            {confirmLabel}
            {selected.size > 0 ? ` (${selected.size})` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
