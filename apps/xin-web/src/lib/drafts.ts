/** channel drafts stored locally per conversation. */
const DRAFT_KEY = "qchat.drafts";

export function loadDrafts(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveDraft(convId: string, text: string) {
  if (typeof window === "undefined" || !convId) return;
  const drafts = loadDrafts();
  if (!text.trim()) delete drafts[convId];
  else drafts[convId] = text;
  localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));
}

export function getDraft(convId: string): string {
  return loadDrafts()[convId] ?? "";
}
