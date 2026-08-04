"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  EMOJI_CATEGORIES,
  allEmojis,
  loadMoodChipOrder,
  loadRecentEmojis,
  pushRecentEmoji,
  saveMoodChipOrder,
  type EmojiCategoryId,
} from "@/lib/emojiData";
import { searchGifs, type GifItem } from "@/lib/gifSearch";
import { STICKER_PACKS, type StickerItem } from "@/lib/stickerData";
import { useLocale } from "@/lib/locale";
import type { MessageKey } from "@qchat/i18n";

export type PickerMedia = {
  url: string;
  name: string;
  kind: "sticker" | "gif";
};

type PickerTab = "emoji" | "stickers" | "gifs";

function CatIcon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.55"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

type MoodChip = { key: string; d: string; emojis: string[]; gifQuery: string };

/** Telegram-style mood / reaction filter chips in the search toolbar. */
const MOOD_CHIPS: MoodChip[] = [
  {
    key: "heart",
    d: "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z",
    emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💟", "❣️", "💔", "😍", "🥰", "😘", "😻"],
    gifQuery: "love",
  },
  {
    key: "up",
    d: "M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3",
    emojis: ["👍", "👌", "✌️", "🤞", "🤟", "🤘", "🤙", "👏", "🙌", "💪", "🫡", "🤝", "✅", "🔥", "⭐", "🌟"],
    gifQuery: "thumbs up",
  },
  {
    key: "down",
    d: "M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17",
    emojis: ["👎", "🖕", "😒", "🙄", "😑", "😐", "😶", "🤦", "🤷", "💔", "🚫", "❌"],
    gifQuery: "thumbs down",
  },
  {
    key: "party",
    d: "M4 10l2-2 6 3 7-8 1 1-8 7 3 6-2 2-4-5-5-4z M14 4l1.5-2.5 M18 7l2.5-1 M16 2l.5 2",
    emojis: ["🎉", "🎊", "🥳", "🎈", "🎁", "🍾", "🥂", "🎂", "🧁", "✨", "🎆", "🎇", "🪩"],
    gifQuery: "party",
  },
  {
    key: "grin",
    d: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M8 14s1.5 2 4 2 4-2 4-2 M9 9h.01 M15 9h.01",
    emojis: ["😀", "😁", "😂", "🤣", "😃", "😄", "😅", "😆", "😉", "😊", "😋", "😎", "🤩", "🙂", "🤗", "🤭"],
    gifQuery: "happy",
  },
  {
    key: "worried",
    d: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 16h.01 M8.5 9.5c.5-.8 1.4-1.2 2.3-.8 M15.5 9.5c-.5-.8-1.4-1.2-2.3-.8 M9 14s.8 1.2 3 1.2 3-1.2 3-1.2",
    emojis: ["😨", "😰", "😱", "😳", "😧", "😦", "😮", "😯", "😲", "🥺", "😟"],
    gifQuery: "shocked",
  },
  {
    key: "sad",
    d: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M16 16s-1.5-2-4-2-4 2-4 2 M9 9h.01 M15 9h.01",
    emojis: ["😢", "😭", "😞", "😔", "☹️", "🙁", "😟", "🥺", "😿", "😥", "😓", "😩", "😫"],
    gifQuery: "sad",
  },
  {
    key: "angry",
    d: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M16 16s-1.5-3-4-3-4 3-4 3 M9 9h.01 M15 9h.01 M8.5 8.5l2 1 M15.5 8.5l-2 1",
    emojis: ["😡", "😠", "🤬", "😤", "👿", "💢", "🗯️", "😈", "💀", "☠️"],
    gifQuery: "angry",
  },
  {
    key: "neutral",
    d: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M8 15h8 M9 9h.01 M15 9h.01",
    emojis: ["😐", "😑", "😶", "🫤", "🤔", "🤨", "😏", "😒", "😬", "😯", "😮", "😲"],
    gifQuery: "meh",
  },
  {
    key: "think",
    d: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M9 9h.01 M15 9h.01 M8 15h5 M17 18c1.2 0 2-.8 2-2s-1-2.5-2-3",
    emojis: ["🤔", "🧐", "🤨", "🤓", "💭", "💡", "🧠"],
    gifQuery: "thinking",
  },
  {
    key: "tongue",
    d: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M9 9h.01 M15 9h.01 M8 13h8 M12 13v4a1.5 1.5 0 0 0 3 0",
    emojis: ["😛", "😜", "😝", "🤪", "😋", "😏", "🙃"],
    gifQuery: "silly",
  },
];

const DEFAULT_MOOD_KEYS = MOOD_CHIPS.map((c) => c.key);
const MOOD_BY_KEY = Object.fromEntries(MOOD_CHIPS.map((c) => [c.key, c])) as Record<string, MoodChip>;

const CATEGORY_LABEL_KEYS: Record<Exclude<EmojiCategoryId, "recent">, MessageKey> = {
  people: "emoji.cat.people",
  nature: "emoji.cat.nature",
  food: "emoji.cat.food",
  activity: "emoji.cat.activity",
  travel: "emoji.cat.travel",
  objects: "emoji.cat.objects",
  symbols: "emoji.cat.symbols",
};

const DRAG_THRESHOLD_PX = 6;

export default function EmojiPicker({
  onPick,
  onPickMedia,
  onClose,
}: {
  onPick: (emoji: string) => void;
  onPickMedia?: (item: PickerMedia) => void;
  onClose?: () => void;
}) {
  const { t } = useLocale();
  const [tab, setTab] = useState<PickerTab>("emoji");
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [moodKey, setMoodKey] = useState<string | null>(null);
  const [moodOrder, setMoodOrder] = useState<string[]>(DEFAULT_MOOD_KEYS);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [gifs, setGifs] = useState<GifItem[]>([]);
  const [gifBusy, setGifBusy] = useState(false);
  const [gifError, setGifError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const catsRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Partial<Record<EmojiCategoryId, HTMLElement | null>>>({});
  const dragRef = useRef<{
    key: string;
    startX: number;
    moved: boolean;
    order: string[];
  } | null>(null);
  const gifTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setRecent(loadRecentEmojis());
    setMoodOrder(loadMoodChipOrder(DEFAULT_MOOD_KEYS));
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    if (tab !== "gifs") return;
    if (gifTimerRef.current) clearTimeout(gifTimerRef.current);
    setGifBusy(true);
    setGifError(null);
    const moodQuery = moodKey && !query.trim() ? MOOD_BY_KEY[moodKey]?.gifQuery ?? "" : "";
    const searchQuery = query.trim() || moodQuery;
    gifTimerRef.current = setTimeout(() => {
      searchGifs(searchQuery)
        .then((list) => setGifs(list))
        .catch((e: any) => {
          setGifs([]);
          setGifError(e?.message || t("gifs.sendFailed"));
        })
        .finally(() => setGifBusy(false));
    }, searchQuery ? 280 : 0);
    return () => {
      if (gifTimerRef.current) clearTimeout(gifTimerRef.current);
    };
  }, [tab, query, moodKey, t]);

  const orderedMoods = useMemo(
    () => moodOrder.map((k) => MOOD_BY_KEY[k]).filter(Boolean),
    [moodOrder]
  );

  const q = query.trim().toLocaleLowerCase();
  const catalog = useMemo(() => allEmojis(), []);

  const searchHits = useMemo(() => {
    if (!q) return null;
    const aliases: Record<string, string[]> = {
      smile: ["😀", "😁", "😊", "😄", "😃"],
      laugh: ["😂", "🤣", "😆", "😅"],
      love: ["😍", "🥰", "😘", "❤️", "💕", "💖"],
      sad: ["😢", "😭", "😞", "😔", "☹️"],
      angry: ["😡", "😠", "🤬", "😤"],
      thumb: ["👍", "👎"],
      fire: ["🔥"],
      party: ["🎉", "🥳", "🎊"],
      ok: ["👌", "✅"],
      heart: ["❤️", "🧡", "💛", "💚", "💙", "💜", "💔", "💕"],
      clap: ["👏"],
      pray: ["🙏"],
      cool: ["😎"],
      think: ["🤔"],
      wave: ["👋"],
      dog: ["🐶", "🐕", "🐩"],
      cat: ["🐱", "🐈", "😺"],
      food: ["🍕", "🍔", "🍟", "🍜", "🍣"],
      coffee: ["☕"],
      beer: ["🍺", "🍻"],
    };
    const hits = new Set<string>();
    for (const [key, list] of Object.entries(aliases)) {
      if (key.includes(q) || q.includes(key)) {
        for (const em of list) hits.add(em);
      }
    }
    for (const em of catalog) {
      if (em.includes(q)) hits.add(em);
    }
    return Array.from(hits);
  }, [catalog, q]);

  const moodEmojis = useMemo(() => {
    if (!moodKey) return null;
    return MOOD_BY_KEY[moodKey]?.emojis ?? null;
  }, [moodKey]);

  const moodEmojiSet = useMemo(() => {
    if (!moodEmojis) return null;
    return new Set(moodEmojis);
  }, [moodEmojis]);

  const filteredStickerPacks = useMemo(() => {
    return STICKER_PACKS.map((pack) => {
      const stickers = pack.stickers.filter((st) => {
        if (moodEmojiSet && !q) return moodEmojiSet.has(st.emoji);
        if (q) {
          const labelHit = st.label.toLocaleLowerCase().includes(q);
          const emojiHit = st.emoji.includes(q);
          if (!labelHit && !emojiHit) return false;
        }
        return true;
      });
      return { ...pack, stickers };
    }).filter((pack) => pack.stickers.length > 0);
  }, [moodEmojiSet, q]);

  function pick(emoji: string) {
    setRecent(pushRecentEmoji(emoji));
    onPick(emoji);
  }

  function pickSticker(sticker: StickerItem) {
    onPickMedia?.({ url: sticker.url, name: sticker.label, kind: "sticker" });
  }

  function pickGif(gif: GifItem) {
    onPickMedia?.({ url: gif.url, name: gif.title || "GIF", kind: "gif" });
  }

  function reorderByPointer(clientX: number, fromKey: string, current: string[]) {
    const root = catsRef.current;
    if (!root) return current;
    const buttons = Array.from(root.querySelectorAll<HTMLElement>("[data-mood-key]"));
    if (buttons.length === 0) return current;

    const without = current.filter((k) => k !== fromKey);
    let target = without.length;
    for (let i = 0; i < buttons.length; i++) {
      const key = buttons[i].dataset.moodKey;
      if (!key || key === fromKey) continue;
      const rect = buttons[i].getBoundingClientRect();
      const mid = rect.left + rect.width / 2;
      if (clientX < mid) {
        target = without.indexOf(key);
        if (target < 0) target = without.length;
        break;
      }
      const idx = without.indexOf(key);
      target = idx < 0 ? without.length : idx + 1;
    }
    target = Math.max(0, Math.min(target, without.length));
    return [...without.slice(0, target), fromKey, ...without.slice(target)];
  }

  function onMoodPointerDown(e: ReactPointerEvent<HTMLButtonElement>, key: string) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      key,
      startX: e.clientX,
      moved: false,
      order: moodOrder,
    };
  }

  function onMoodPointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.key !== e.currentTarget.dataset.moodKey) return;
    const dx = Math.abs(e.clientX - drag.startX);
    if (!drag.moved && dx < DRAG_THRESHOLD_PX) return;
    if (!drag.moved) {
      drag.moved = true;
      setDraggingKey(drag.key);
    }
    const next = reorderByPointer(e.clientX, drag.key, drag.order);
    const same =
      next.length === drag.order.length && next.every((k, i) => k === drag.order[i]);
    if (!same) {
      drag.order = next;
      setMoodOrder(next);
    }
  }

  function onMoodPointerUp(e: ReactPointerEvent<HTMLButtonElement>, key: string) {
    const drag = dragRef.current;
    dragRef.current = null;
    setDraggingKey(null);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (!drag || drag.key !== key) return;
    if (drag.moved) {
      saveMoodChipOrder(drag.order);
      return;
    }
    setQuery("");
    setMoodKey((cur) => (cur === key ? null : key));
    bodyRef.current?.scrollTo({ top: 0 });
  }

  const showSearch = Boolean(q);
  const showMood = Boolean(moodEmojis) && !showSearch;
  const filteredList = showSearch ? searchHits ?? [] : moodEmojis ?? [];
  const gifSectionTitle =
    query.trim() || (moodKey && MOOD_BY_KEY[moodKey]?.gifQuery)
      ? t("emoji.searchResults")
      : t("gifs.trending");

  return (
    <div className="emoji-picker" role="dialog" aria-label={t("chat.emoji")}>
      <div className="emoji-picker-header">
        <div className="emoji-picker-tabs" role="tablist" aria-label={t("chat.emoji")}>
          {(
            [
              ["emoji", "emoji.tabEmoji"],
              ["stickers", "emoji.tabStickers"],
              ["gifs", "emoji.tabGifs"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`emoji-picker-tab${tab === id ? " is-active" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setTab(id);
                // Keep mood across tabs; drop free-text search when leaving GIFs.
                if (id !== "gifs") setQuery("");
                bodyRef.current?.scrollTo({ top: 0 });
              }}
            >
              {t(label)}
            </button>
          ))}
        </div>

        <div className="emoji-picker-toolbar">
          <button
            type="button"
            className="emoji-picker-back"
            title={t("chat.close")}
            aria-label={t("chat.close")}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (query || moodKey) {
                setQuery("");
                setMoodKey(null);
                return;
              }
              onClose?.();
            }}
          >
            <CatIcon d="M15 18l-6-6 6-6" size={20} />
          </button>

          <div className="emoji-picker-search-pill">
            <div className="emoji-picker-search">
              <CatIcon d="M11 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12z M21 21l-4.3-4.3" size={16} />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (e.target.value.trim()) setMoodKey(null);
                }}
                placeholder={
                  tab === "gifs"
                    ? t("gifs.searchPlaceholder")
                    : t("common.search")
                }
                autoComplete="off"
                spellCheck={false}
                onMouseDown={(e) => e.stopPropagation()}
              />
            </div>
          </div>
        </div>

        <div
          className={`emoji-picker-cats${draggingKey ? " is-dragging" : ""}`}
          ref={catsRef}
          role="tablist"
          aria-label={t("emoji.categories")}
        >
          {orderedMoods.map((item) => (
            <button
              key={item.key}
              type="button"
              data-mood-key={item.key}
              className={`emoji-picker-cat-btn${
                moodKey === item.key && !showSearch ? " is-active" : ""
              }${draggingKey === item.key ? " is-dragging" : ""}`}
              title={t("emoji.dragHint")}
              onPointerDown={(e) => onMoodPointerDown(e, item.key)}
              onPointerMove={onMoodPointerMove}
              onPointerUp={(e) => onMoodPointerUp(e, item.key)}
              onPointerCancel={(e) => onMoodPointerUp(e, item.key)}
              onContextMenu={(e) => e.preventDefault()}
            >
              <CatIcon d={item.d} size={16} />
            </button>
          ))}
        </div>
      </div>

      <div className="emoji-picker-body" ref={bodyRef}>
        {tab === "emoji" && (
          <>
            {showSearch || showMood ? (
              <div className="emoji-picker-section">
                <div className="emoji-picker-section-title">
                  {showSearch ? t("emoji.searchResults") : t("chat.emoji")}
                </div>
                {filteredList.length === 0 ? (
                  <div className="emoji-picker-empty">{t("chat.noResults")}</div>
                ) : (
                  <div className="emoji-picker-grid">
                    {filteredList.map((em) => (
                      <button
                        key={`f-${em}`}
                        type="button"
                        className="emoji-picker-cell"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          pick(em);
                        }}
                      >
                        {em}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                {recent.length > 0 && (
                  <div
                    className="emoji-picker-section"
                    ref={(el) => {
                      sectionRefs.current.recent = el;
                    }}
                  >
                    <div className="emoji-picker-section-title">{t("emoji.recent")}</div>
                    <div className="emoji-picker-grid">
                      {recent.map((em) => (
                        <button
                          key={`r-${em}`}
                          type="button"
                          className="emoji-picker-cell"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            pick(em);
                          }}
                        >
                          {em}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {EMOJI_CATEGORIES.map((cat) => (
                  <div
                    key={cat.id}
                    className="emoji-picker-section"
                    ref={(el) => {
                      sectionRefs.current[cat.id] = el;
                    }}
                  >
                    <div className="emoji-picker-section-title">
                      {t(CATEGORY_LABEL_KEYS[cat.id as Exclude<EmojiCategoryId, "recent">])}
                    </div>
                    <div className="emoji-picker-grid">
                      {cat.emojis.map((em) => (
                        <button
                          key={`${cat.id}-${em}`}
                          type="button"
                          className="emoji-picker-cell"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            pick(em);
                          }}
                        >
                          {em}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
          </>
        )}

        {tab === "stickers" && (
          <>
            {filteredStickerPacks.length === 0 ? (
              <div className="emoji-picker-empty">{t("chat.noResults")}</div>
            ) : (
              filteredStickerPacks.map((pack) => (
                <div className="emoji-picker-section" key={pack.id}>
                  <div className="emoji-picker-section-title">{t(pack.labelKey)}</div>
                  <div className="sticker-picker-grid">
                    {pack.stickers.map((st) => (
                      <button
                        key={st.id}
                        type="button"
                        className="sticker-picker-cell"
                        title={st.label}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          pickSticker(st);
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={st.url} alt={st.label} loading="lazy" />
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </>
        )}

        {tab === "gifs" && (
          <div className="emoji-picker-section">
            <div className="emoji-picker-section-title">{gifSectionTitle}</div>
            {gifBusy ? (
              <div className="emoji-picker-empty">{t("gifs.loading")}</div>
            ) : gifError ? (
              <div className="emoji-picker-empty">{gifError}</div>
            ) : gifs.length === 0 ? (
              <div className="emoji-picker-empty">{t("gifs.empty")}</div>
            ) : (
              <div className="gif-picker-grid">
                {gifs.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    className="gif-picker-cell"
                    title={g.title}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pickGif(g);
                    }}
                    onMouseEnter={(e) => {
                      const img = e.currentTarget.querySelector("img");
                      if (img && g.animateUrl && g.animateUrl !== g.previewUrl) {
                        img.src = g.animateUrl;
                      }
                    }}
                    onMouseLeave={(e) => {
                      const img = e.currentTarget.querySelector("img");
                      if (img && g.previewUrl) {
                        img.src = g.previewUrl;
                      }
                    }}
                    onFocus={(e) => {
                      const img = e.currentTarget.querySelector("img");
                      if (img && g.animateUrl && g.animateUrl !== g.previewUrl) {
                        img.src = g.animateUrl;
                      }
                    }}
                    onBlur={(e) => {
                      const img = e.currentTarget.querySelector("img");
                      if (img && g.previewUrl) {
                        img.src = g.previewUrl;
                      }
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={g.previewUrl}
                      alt={g.title}
                      loading="lazy"
                      decoding="async"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
