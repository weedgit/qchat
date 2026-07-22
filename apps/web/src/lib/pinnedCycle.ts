/** Pinned message summary from API (ordered by seq ascending = top→bottom). */
export type PinnedMessage = {
  id: string;
  body: string;
  type?: string;
  seq?: number;
};

/** Previous pin in the cycle (bottom→top), wrapping to the bottom-most pin. */
export function previousPinnedInCycle(
  pinsAsc: PinnedMessage[],
  currentId: string
): PinnedMessage | null {
  if (pinsAsc.length === 0) return null;
  const idx = pinsAsc.findIndex((p) => p.id === currentId);
  if (idx <= 0) return pinsAsc[pinsAsc.length - 1];
  return pinsAsc[idx - 1];
}

/**
 * Next pin to show on the bar / jump to on click.
 * Cycle order is bottom→top (pin3→pin2→pin1), wrapping to the bottom-most pin.
 *
 * - Well below pin3 → pin3
 * - At / on pin3 → pin2 (previous)
 * - At top of pin1 → pin3 (wrap)
 */
export function nextPinnedFromScroll(
  pinsAsc: PinnedMessage[],
  focusY: number,
  messageTopById: Record<string, number>
): PinnedMessage | null {
  if (pinsAsc.length === 0) return null;

  // How close focus must be to a pin's top to treat it as "arrived" (advance to previous).
  const AT = 120;

  let nearestIdx = -1;
  let nearestTop = -Infinity;
  for (let i = 0; i < pinsAsc.length; i++) {
    const top = messageTopById[pinsAsc[i].id];
    if (typeof top !== "number") continue;
    if (top < focusY && top >= nearestTop) {
      nearestTop = top;
      nearestIdx = i;
    }
  }

  if (nearestIdx < 0) {
    // No pin above the focus line — above all pins → wrap to bottom-most.
    return pinsAsc[pinsAsc.length - 1];
  }

  // Still well below this pin → jump to it; once arrived, advance to previous.
  if (focusY - nearestTop > AT) {
    return pinsAsc[nearestIdx];
  }
  return previousPinnedInCycle(pinsAsc, pinsAsc[nearestIdx].id);
}

export function normalizePinnedMessages(raw: any): PinnedMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p: any) => ({
      id: String(p?.id ?? ""),
      body: String(p?.body ?? p?.content ?? "").trim() || "Pinned message",
      type: p?.type ? String(p.type) : undefined,
      seq: typeof p?.seq === "number" ? p.seq : undefined,
    }))
    .filter((p) => p.id)
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}
