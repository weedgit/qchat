"use client";

import { FormEvent, useState } from "react";
import { api } from "@/lib/api";

type Props = {
  friendshipId: string;
  note: string;
  tags: string[];
  onSaved: () => void;
  compact?: boolean;
  /** When true, open the editor immediately (modal use). */
  startOpen?: boolean;
};

/** Edit viewer-scoped friend note/alias + tags (PATCH /v1/friends/{friendship_id}). */
export default function FriendNoteEditor({
  friendshipId,
  note,
  tags,
  onSaved,
  compact,
  startOpen,
}: Props) {
  const [open, setOpen] = useState(!!startOpen);
  const [noteDraft, setNoteDraft] = useState(note);
  const [tagInput, setTagInput] = useState("");
  const [tagList, setTagList] = useState<string[]>(tags);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setNoteDraft(note);
    setTagList(tags);
    setTagInput("");
    setError(null);
    setOpen(true);
  }

  function addTag() {
    const t = tagInput.trim().replace(/^#/, "");
    if (!t) return;
    if (!tagList.includes(t)) setTagList((prev) => [...prev, t]);
    setTagInput("");
  }

  function removeTag(t: string) {
    setTagList((prev) => prev.filter((x) => x !== t));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/v1/friends/${friendshipId}`, {
        method: "PATCH",
        body: JSON.stringify({ note: noteDraft.trim(), tags: tagList }),
      });
      setOpen(false);
      onSaved();
    } catch (err: any) {
      setError(err.message);
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
        {note || tags.length ? "Edit note & tags" : "Add note & tags"}
      </button>
    );
  }

  return (
    <form className="friend-note-editor" onSubmit={save}>
      <label className="k">Alias / note</label>
      <input
        placeholder="How you refer to them"
        value={noteDraft}
        onChange={(e) => setNoteDraft(e.target.value)}
        maxLength={80}
        autoFocus
      />
      <label className="k">Tags</label>
      <div className="tag-chip-row">
        {tagList.map((t) => (
          <button
            key={t}
            type="button"
            className="tag-chip removable"
            onClick={() => removeTag(t)}
            title="Remove tag"
          >
            #{t} ×
          </button>
        ))}
      </div>
      <div className="row-inline">
        <input
          placeholder="Add tag"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag();
            }
          }}
        />
        <button type="button" className="btn-ghost" style={{ flex: "none" }} onClick={addTag}>
          Add
        </button>
      </div>
      {error && <div className="error-text">{error}</div>}
      <div className="row-inline" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button type="submit" className="btn" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
