"use client";

import { FormEvent, useEffect, useState } from "react";
import { formatApiError } from "@qchat/i18n";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/locale";

type Props = {
  friendshipId: string;
  note: string;
  tags: string[];
  onSaved: (saved: { note: string; tags: string[] }) => void;
  compact?: boolean;
  /** When true, open the editor immediately (modal use). */
  startOpen?: boolean;
  /** Telegram sheet layout (no nested card chrome). */
  layout?: "card" | "sheet";
  formId?: string;
  hideActions?: boolean;
  onCancel?: () => void;
};

/** Edit viewer-scoped friend note/alias + tags (PATCH /v1/friends/{friendship_id}). */
export default function FriendNoteEditor({
  friendshipId,
  note,
  tags,
  onSaved,
  compact,
  startOpen,
  layout = "card",
  formId = "friend-note-form",
  hideActions,
  onCancel,
}: Props) {
  const { t } = useLocale();
  const [open, setOpen] = useState(!!startOpen);
  const [noteDraft, setNoteDraft] = useState(note);
  const [tagInput, setTagInput] = useState("");
  const [tagList, setTagList] = useState<string[]>(tags);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sheet = layout === "sheet";

  // Keep closed-button label in sync after parent reloads prefs.
  useEffect(() => {
    if (open) return;
    setNoteDraft(note);
    setTagList(tags);
  }, [note, tags, open]);

  function startEdit() {
    setNoteDraft(note);
    setTagList(tags);
    setTagInput("");
    setError(null);
    setOpen(true);
  }

  function addTag() {
    const next = tagInput.trim().replace(/^#/, "");
    if (!next) return;
    if (!tagList.includes(next)) setTagList((prev) => [...prev, next]);
    setTagInput("");
  }

  function removeTag(tag: string) {
    setTagList((prev) => prev.filter((x) => x !== tag));
  }

  function cancel() {
    setOpen(false);
    onCancel?.();
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const nextNote = noteDraft.trim();
    const nextTags = [...tagList];
    try {
      await api(`/v1/friends/${friendshipId}`, {
        method: "PATCH",
        body: JSON.stringify({ note: nextNote, tags: nextTags }),
      });
      setNoteDraft(nextNote);
      setTagList(nextTags);
      setOpen(false);
      onSaved({ note: nextNote, tags: nextTags });
    } catch (err: any) {
      setError(formatApiError(err, t));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className={compact ? "btn-ghost" : "btn"}
        style={{ marginTop: compact ? 0 : 12, width: compact ? undefined : "100%" }}
        onClick={startEdit}
      >
        {note || tags.length ? t("contacts.editNote") : t("contacts.addNote")}
      </button>
    );
  }

  return (
    <form
      id={formId}
      className={sheet ? "friend-note-sheet" : "friend-note-editor"}
      onSubmit={save}
    >
      <label className={sheet ? "menu-modal-field" : undefined}>
        {sheet ? <span>{t("contacts.alias")}</span> : <span className="k">{t("contacts.alias")}</span>}
        <input
          placeholder={t("contacts.aliasPlaceholder")}
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          maxLength={80}
          autoFocus
        />
      </label>

      <div className={sheet ? "menu-modal-field" : undefined}>
        {sheet ? <span>{t("contacts.tags")}</span> : <label className="k">{t("contacts.tags")}</label>}
        {tagList.length > 0 && (
          <div className="tag-chip-row" style={{ marginTop: sheet ? 0 : undefined }}>
            {tagList.map((tag) => (
              <button
                key={tag}
                type="button"
                className="tag-chip removable"
                onClick={() => removeTag(tag)}
                title={t("contacts.removeTag")}
              >
                #{tag} ×
              </button>
            ))}
          </div>
        )}
        <div className="menu-modal-search-row" style={{ marginTop: 8 }}>
          <input
            placeholder={t("contacts.addTagPlaceholder")}
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag();
              }
            }}
          />
          <button type="button" className="btn-ghost" onClick={addTag}>
            {t("contacts.addButton")}
          </button>
        </div>
      </div>

      {error && <div className={sheet ? "menu-modal-error" : "error-text"}>{error}</div>}

      {!hideActions && (
        <div className="row-inline" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn-ghost" disabled={busy} onClick={cancel}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn" disabled={busy}>
            {busy ? t("common.saving") : t("common.save")}
          </button>
        </div>
      )}
    </form>
  );
}
