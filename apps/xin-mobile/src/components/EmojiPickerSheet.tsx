/**
 * Mobile emoji / stickers / GIFs sheet — layout mirrors web EmojiPicker:
 * tabs · back + search · mood chips · sectioned grids.
 */
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  EMOJI_CATEGORIES,
  allEmojis,
  loadRecentEmojis,
  pushRecentEmoji,
  type EmojiCategoryId,
} from "../lib/emojiData";
import { searchGifs, type GifItem } from "../lib/gifSearch";
import { STICKER_PACKS, type StickerItem } from "../lib/stickerData";
import { useTheme, useThemedStyles } from "../context/ThemeContext";
import { spacing, type ColorTokens } from "../theme";

export type PickerMedia = {
  url: string;
  name: string;
  kind: "sticker" | "gif";
};

type PickerTab = "emoji" | "stickers" | "gifs";

type MoodChip = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  emojis: string[];
  gifQuery: string;
};

const MOOD_CHIPS: MoodChip[] = [
  {
    key: "heart",
    icon: "heart",
    emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💟", "❣️", "💔", "😍", "🥰", "😘", "😻"],
    gifQuery: "love",
  },
  {
    key: "up",
    icon: "thumbs-up",
    emojis: ["👍", "👌", "✌️", "🤞", "🤟", "🤘", "🤙", "👏", "🙌", "💪", "🫡", "🤝", "✅", "🔥", "⭐", "🌟"],
    gifQuery: "thumbs up",
  },
  {
    key: "down",
    icon: "thumbs-down",
    emojis: ["👎", "🖕", "😒", "🙄", "😑", "😐", "😶", "🤦", "🤷", "💔", "🚫", "❌"],
    gifQuery: "thumbs down",
  },
  {
    key: "party",
    icon: "gift",
    emojis: ["🎉", "🎊", "🥳", "🎈", "🎁", "🍾", "🥂", "🎂", "🧁", "✨", "🎆", "🎇", "🪩"],
    gifQuery: "party",
  },
  {
    key: "grin",
    icon: "happy",
    emojis: ["😀", "😁", "😂", "🤣", "😃", "😄", "😅", "😆", "😉", "😊", "😋", "😎", "🤩", "🙂", "🤗", "🤭"],
    gifQuery: "happy",
  },
  {
    key: "worried",
    icon: "alert-circle",
    emojis: ["😨", "😰", "😱", "😳", "😧", "😦", "😮", "😯", "😲", "🥺", "😟"],
    gifQuery: "shocked",
  },
  {
    key: "sad",
    icon: "sad",
    emojis: ["😢", "😭", "😞", "😔", "☹️", "🙁", "😟", "🥺", "😿", "😥", "😓", "😩", "😫"],
    gifQuery: "sad",
  },
  {
    key: "angry",
    icon: "flame",
    emojis: ["😡", "😠", "🤬", "😤", "👿", "💢", "🗯️", "😈", "💀", "☠️"],
    gifQuery: "angry",
  },
  {
    key: "neutral",
    icon: "remove",
    emojis: ["😐", "😑", "😶", "🫤", "🤔", "🤨", "😏", "😒", "😬", "😯", "😮", "😲"],
    gifQuery: "meh",
  },
  {
    key: "think",
    icon: "help-circle",
    emojis: ["🤔", "🧐", "🤨", "🤓", "💭", "💡", "🧠"],
    gifQuery: "thinking",
  },
  {
    key: "tongue",
    icon: "happy-outline",
    emojis: ["😛", "😜", "😝", "🤪", "😋", "😏", "🙃"],
    gifQuery: "silly",
  },
];

const MOOD_BY_KEY = Object.fromEntries(MOOD_CHIPS.map((c) => [c.key, c])) as Record<
  string,
  MoodChip
>;

const CATEGORY_LABELS: Record<Exclude<EmojiCategoryId, "recent">, string> = {
  people: "Smileys & people",
  nature: "Animals & nature",
  food: "Food & drink",
  activity: "Activity",
  travel: "Travel & places",
  objects: "Objects",
  symbols: "Symbols",
};

const PACK_LABELS: Record<string, string> = {
  smileys: "Smileys",
  animals: "Animals",
  gestures: "Gestures",
  celebration: "Celebration",
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onPickEmoji: (emoji: string) => void;
  onPickMedia: (item: PickerMedia) => void;
};

export function EmojiPickerSheet({ visible, onClose, onPickEmoji, onPickMedia }: Props) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [tab, setTab] = useState<PickerTab>("emoji");
  const [query, setQuery] = useState("");
  const [moodKey, setMoodKey] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [gifs, setGifs] = useState<GifItem[]>([]);
  const [gifBusy, setGifBusy] = useState(false);
  const [gifError, setGifError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setRecent(loadRecentEmojis());
  }, [visible]);

  useEffect(() => {
    if (!visible || tab !== "gifs") return;
    setGifBusy(true);
    setGifError(null);
    const moodQuery = moodKey && !query.trim() ? MOOD_BY_KEY[moodKey]?.gifQuery ?? "" : "";
    const searchQuery = query.trim() || moodQuery;
    const t = setTimeout(() => {
      searchGifs(searchQuery)
        .then((list) => setGifs(list))
        .catch((e: any) => {
          setGifs([]);
          setGifError(e?.message || "Could not load GIFs");
        })
        .finally(() => setGifBusy(false));
    }, searchQuery ? 280 : 0);
    return () => clearTimeout(t);
  }, [visible, tab, query, moodKey]);

  const q = query.trim().toLowerCase();
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
      heart: ["❤️", "🧡", "💛", "💚", "💙", "💜", "💔", "💕"],
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

  const moodEmojis = moodKey ? MOOD_BY_KEY[moodKey]?.emojis ?? null : null;
  const moodEmojiSet = useMemo(
    () => (moodEmojis ? new Set(moodEmojis) : null),
    [moodEmojis]
  );

  const filteredStickerPacks = useMemo(() => {
    return STICKER_PACKS.map((pack) => {
      const stickers = pack.stickers.filter((st) => {
        if (moodEmojiSet && !q) return moodEmojiSet.has(st.emoji);
        if (q) {
          const labelHit = st.label.toLowerCase().includes(q);
          const emojiHit = st.emoji.includes(q);
          if (!labelHit && !emojiHit) return false;
        }
        return true;
      });
      return { ...pack, stickers };
    }).filter((pack) => pack.stickers.length > 0);
  }, [moodEmojiSet, q]);

  const showSearch = Boolean(q);
  const showMood = Boolean(moodEmojis) && !showSearch;
  const filteredList = showSearch ? searchHits ?? [] : moodEmojis ?? [];
  const gifSectionTitle =
    query.trim() || (moodKey && MOOD_BY_KEY[moodKey]?.gifQuery)
      ? "Search results"
      : "Trending";

  function pickEmoji(em: string) {
    setRecent(pushRecentEmoji(em));
    onPickEmoji(em);
  }

  function pickSticker(st: StickerItem) {
    onPickMedia({ url: st.url, name: st.label, kind: "sticker" });
  }

  function pickGif(g: GifItem) {
    onPickMedia({ url: g.url, name: g.title || "GIF", kind: "gif" });
  }

  function onBack() {
    if (query || moodKey) {
      setQuery("");
      setMoodKey(null);
      return;
    }
    onClose();
  }

  function resetAndClose() {
    setQuery("");
    setMoodKey(null);
    setTab("emoji");
    onClose();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={resetAndClose}
    >
      <Pressable style={styles.backdrop} onPress={resetAndClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}
          onPress={() => {}}
        >
          {/* Tabs — web-style full-width underline */}
          <View style={styles.tabs}>
            {(
              [
                ["emoji", "Emoji"],
                ["stickers", "Stickers"],
                ["gifs", "GIFs"],
              ] as const
            ).map(([id, label]) => {
              const active = tab === id;
              return (
                <Pressable
                  key={id}
                  style={[styles.tab, active && styles.tabActive]}
                  onPress={() => {
                    setTab(id);
                    if (id !== "gifs") setQuery("");
                  }}
                >
                  <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* Back + search pill */}
          <View style={styles.toolbar}>
            <Pressable style={styles.backBtn} onPress={onBack} hitSlop={8}>
              <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
            </Pressable>
            <View style={styles.searchPill}>
              <Ionicons name="search" size={16} color={colors.textMuted} />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={(v) => {
                  setQuery(v);
                  if (v.trim()) setMoodKey(null);
                }}
                placeholder={tab === "gifs" ? "Search GIFs" : "Search"}
                placeholderTextColor={colors.textMuted}
                autoCorrect={false}
                autoCapitalize="none"
              />
              {query ? (
                <Pressable onPress={() => setQuery("")} hitSlop={6}>
                  <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                </Pressable>
              ) : null}
            </View>
          </View>

          {/* Mood filter chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.moodRow}
            contentContainerStyle={styles.moodRowContent}
          >
            {MOOD_CHIPS.map((m) => {
              const active = moodKey === m.key && !showSearch;
              return (
                <Pressable
                  key={m.key}
                  style={[styles.moodChip, active && styles.moodChipActive]}
                  onPress={() => {
                    setQuery("");
                    setMoodKey((cur) => (cur === m.key ? null : m.key));
                  }}
                >
                  <Ionicons
                    name={m.icon}
                    size={16}
                    color={active ? colors.accent : colors.textSecondary}
                  />
                </Pressable>
              );
            })}
          </ScrollView>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
          >
            {tab === "emoji" ? (
              showSearch || showMood ? (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>
                    {showSearch ? "Search results" : "Emoji"}
                  </Text>
                  {filteredList.length === 0 ? (
                    <Text style={styles.empty}>No results</Text>
                  ) : (
                    <View style={styles.emojiGrid}>
                      {filteredList.map((em) => (
                        <Pressable
                          key={`f-${em}`}
                          style={styles.emojiCell}
                          onPress={() => pickEmoji(em)}
                        >
                          <Text style={styles.emojiGlyph}>{em}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
              ) : (
                <>
                  {recent.length > 0 ? (
                    <View style={styles.section}>
                      <Text style={styles.sectionTitle}>Recently used</Text>
                      <View style={styles.emojiGrid}>
                        {recent.map((em) => (
                          <Pressable
                            key={`r-${em}`}
                            style={styles.emojiCell}
                            onPress={() => pickEmoji(em)}
                          >
                            <Text style={styles.emojiGlyph}>{em}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  ) : null}
                  {EMOJI_CATEGORIES.map((cat) => (
                    <View key={cat.id} style={styles.section}>
                      <Text style={styles.sectionTitle}>
                        {CATEGORY_LABELS[cat.id as Exclude<EmojiCategoryId, "recent">]}
                      </Text>
                      <View style={styles.emojiGrid}>
                        {cat.emojis.map((em) => (
                          <Pressable
                            key={`${cat.id}-${em}`}
                            style={styles.emojiCell}
                            onPress={() => pickEmoji(em)}
                          >
                            <Text style={styles.emojiGlyph}>{em}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  ))}
                </>
              )
            ) : null}

            {tab === "stickers" ? (
              filteredStickerPacks.length === 0 ? (
                <Text style={styles.empty}>No results</Text>
              ) : (
                filteredStickerPacks.map((pack) => (
                  <View key={pack.id} style={styles.section}>
                    <Text style={styles.sectionTitle}>
                      {PACK_LABELS[pack.id] || pack.id}
                    </Text>
                    <View style={styles.stickerGrid}>
                      {pack.stickers.map((st) => (
                        <Pressable
                          key={st.id}
                          style={styles.stickerCell}
                          onPress={() => pickSticker(st)}
                        >
                          <Image
                            source={{ uri: st.url }}
                            style={styles.stickerImg}
                            resizeMode="contain"
                          />
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ))
              )
            ) : null}

            {tab === "gifs" ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{gifSectionTitle}</Text>
                {gifBusy ? (
                  <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
                ) : gifError ? (
                  <Text style={styles.empty}>{gifError}</Text>
                ) : gifs.length === 0 ? (
                  <Text style={styles.empty}>No GIFs found</Text>
                ) : (
                  <View style={styles.gifGrid}>
                    {gifs.map((g) => (
                      <Pressable
                        key={g.id}
                        style={styles.gifCell}
                        onPress={() => pickGif(g)}
                      >
                        <Image
                          source={{ uri: g.previewUrl }}
                          style={styles.gifImg}
                          resizeMode="cover"
                        />
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(c: ColorTokens) {
  const panel = c.surface;
  const panel2 = c.inputBg;
  return {
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.45)",
      justifyContent: "flex-end" as const,
    },
    sheet: {
      backgroundColor: panel,
      borderTopLeftRadius: 14,
      borderTopRightRadius: 14,
      maxHeight: "72%" as const,
      minHeight: "58%" as const,
      overflow: "hidden" as const,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    tabs: {
      flexDirection: "row" as const,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    tab: {
      flex: 1,
      paddingVertical: 12,
      alignItems: "center" as const,
      borderBottomWidth: 2,
      borderBottomColor: "transparent",
    },
    tabActive: {
      borderBottomColor: c.accent,
    },
    tabText: {
      fontSize: 12,
      fontWeight: "600" as const,
      color: c.textMuted,
    },
    tabTextActive: {
      color: c.accent,
    },
    toolbar: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 4,
      paddingHorizontal: 10,
      paddingTop: 8,
      paddingBottom: 6,
    },
    backBtn: {
      width: 32,
      height: 32,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      borderRadius: 8,
    },
    searchPill: {
      flex: 1,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: panel2,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    searchInput: {
      flex: 1,
      fontSize: 14,
      color: c.text,
      padding: 0,
      margin: 0,
    },
    moodRow: {
      maxHeight: 44,
      flexGrow: 0,
    },
    moodRowContent: {
      paddingHorizontal: 10,
      gap: 4,
      alignItems: "center" as const,
      paddingBottom: 6,
    },
    moodChip: {
      width: 34,
      height: 34,
      borderRadius: 8,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    moodChipActive: {
      backgroundColor: "rgba(36,99,220,0.15)",
    },
    body: {
      flex: 1,
    },
    bodyContent: {
      paddingBottom: spacing.lg,
    },
    section: {
      paddingTop: 4,
      paddingBottom: 8,
    },
    sectionTitle: {
      fontSize: 11,
      fontWeight: "700" as const,
      letterSpacing: 0.4,
      textTransform: "uppercase" as const,
      color: c.textMuted,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    empty: {
      textAlign: "center" as const,
      color: c.textMuted,
      paddingVertical: 28,
      paddingHorizontal: 16,
      fontSize: 14,
    },
    emojiGrid: {
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      paddingHorizontal: 8,
    },
    emojiCell: {
      width: "12.5%" as const,
      aspectRatio: 1,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    emojiGlyph: {
      fontSize: 26,
    },
    stickerGrid: {
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      paddingHorizontal: 10,
      gap: 6,
    },
    stickerCell: {
      width: 56,
      height: 56,
      padding: 4,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    stickerImg: {
      width: 48,
      height: 48,
    },
    gifGrid: {
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      paddingHorizontal: 10,
      gap: 6,
    },
    gifCell: {
      width: "48%" as const,
      flexGrow: 1,
      aspectRatio: 1.2,
      borderRadius: 10,
      overflow: "hidden" as const,
      backgroundColor: panel2,
    },
    gifImg: {
      width: "100%" as const,
      height: "100%" as const,
    },
  };
}
