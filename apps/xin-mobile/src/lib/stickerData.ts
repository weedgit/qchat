/** Built-in sticker packs. Prefer Google Noto Animated Emoji (WebP); Twemoji PNG fallback. */

export type StickerItem = {
  id: string;
  emoji: string;
  label: string;
  url: string;
};

export type StickerPack = {
  id: string;
  labelKey: "stickers.packSmileys" | "stickers.packAnimals" | "stickers.packGestures" | "stickers.packCelebration";
  stickers: StickerItem[];
};

/** Hex codepoints for an emoji, skipping VS-16 (U+FE0F). */
export function emojiCodepointsHex(emoji: string, sep: "-" | "_" = "-"): string {
  return Array.from(emoji)
    .map((ch) => ch.codePointAt(0))
    .filter((cp): cp is number => typeof cp === "number" && cp !== 0xfe0f)
    .map((cp) => cp.toString(16))
    .join(sep);
}

/** Map an emoji to a Twemoji 72×72 PNG on jsDelivr (static). */
export function emojiToTwemojiUrl(emoji: string): string {
  const hex = emojiCodepointsHex(emoji, "-");
  return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${hex}.png`;
}

/** Map an emoji to Google Noto Animated Emoji WebP (loops like a GIF). */
export function emojiToAnimatedUrl(emoji: string): string {
  const hex = emojiCodepointsHex(emoji, "_");
  return `https://fonts.gstatic.com/s/e/notoemoji/latest/${hex}/512.webp`;
}

/**
 * Animals / glyphs known missing from Noto animated set — keep Twemoji PNG.
 * Verified against fonts.gstatic.com notoemoji latest (2026-07).
 */
const STATIC_ONLY_HEX = new Set([
  "1f436", // 🐶
  "1f42d", // 🐭
  "1f439", // 🐹
  "1f430", // 🐰
  "1f428", // 🐨
  "1f42f", // 🐯
  "1f435", // 🐵
]);

/** Prefer animated WebP for stickers / large emoji; static PNG when unavailable. */
export function emojiToStickerUrl(emoji: string): string {
  const hex = emojiCodepointsHex(emoji, "_");
  if (STATIC_ONLY_HEX.has(hex)) return emojiToTwemojiUrl(emoji);
  return emojiToAnimatedUrl(emoji);
}

/**
 * Upgrade a stored Twemoji sticker URL to animated Noto WebP when available.
 * Leaves GIF / other media URLs unchanged.
 */
export function maybeAnimateStickerUrl(url: string): string {
  const m = url.match(/\/twemoji@[^/]+\/assets\/\d+x\d+\/([0-9a-f-]+)\.png(?:\?|$)/i);
  if (!m) return url;
  const hex = m[1].replace(/-/g, "_");
  if (STATIC_ONLY_HEX.has(hex)) return url;
  return `https://fonts.gstatic.com/s/e/notoemoji/latest/${hex}/512.webp`;
}

function pack(
  id: string,
  labelKey: StickerPack["labelKey"],
  items: { emoji: string; label: string }[]
): StickerPack {
  return {
    id,
    labelKey,
    stickers: items.map((it, i) => ({
      id: `${id}-${i}`,
      emoji: it.emoji,
      label: it.label,
      url: emojiToStickerUrl(it.emoji),
    })),
  };
}

export const STICKER_PACKS: StickerPack[] = [
  pack("smileys", "stickers.packSmileys", [
    { emoji: "😀", label: "Grin" },
    { emoji: "😂", label: "Tears of joy" },
    { emoji: "🤣", label: "ROFL" },
    { emoji: "😊", label: "Smile" },
    { emoji: "😍", label: "Heart eyes" },
    { emoji: "🥰", label: "Smiling hearts" },
    { emoji: "😎", label: "Cool" },
    { emoji: "🤩", label: "Starstruck" },
    { emoji: "😘", label: "Kiss" },
    { emoji: "🤗", label: "Hug" },
    { emoji: "🤔", label: "Thinking" },
    { emoji: "😴", label: "Sleeping" },
    { emoji: "😭", label: "Sob" },
    { emoji: "😡", label: "Angry" },
    { emoji: "🤯", label: "Exploding head" },
    { emoji: "🥳", label: "Party" },
  ]),
  pack("animals", "stickers.packAnimals", [
    { emoji: "🐶", label: "Dog" },
    { emoji: "🐱", label: "Cat" },
    { emoji: "🐭", label: "Mouse" },
    { emoji: "🐹", label: "Hamster" },
    { emoji: "🐰", label: "Rabbit" },
    { emoji: "🦊", label: "Fox" },
    { emoji: "🐻", label: "Bear" },
    { emoji: "🐼", label: "Panda" },
    { emoji: "🐨", label: "Koala" },
    { emoji: "🐯", label: "Tiger" },
    { emoji: "🦁", label: "Lion" },
    { emoji: "🐸", label: "Frog" },
    { emoji: "🐵", label: "Monkey" },
    { emoji: "🦄", label: "Unicorn" },
    { emoji: "🐝", label: "Bee" },
    { emoji: "🦋", label: "Butterfly" },
  ]),
  pack("gestures", "stickers.packGestures", [
    { emoji: "👍", label: "Thumbs up" },
    { emoji: "👎", label: "Thumbs down" },
    { emoji: "👏", label: "Clap" },
    { emoji: "🙌", label: "Praise" },
    { emoji: "🤝", label: "Handshake" },
    { emoji: "✌️", label: "Victory" },
    { emoji: "🤞", label: "Fingers crossed" },
    { emoji: "🤟", label: "Love you" },
    { emoji: "🤘", label: "Rock on" },
    { emoji: "🤙", label: "Call me" },
    { emoji: "👋", label: "Wave" },
    { emoji: "💪", label: "Strong" },
    { emoji: "🙏", label: "Pray" },
    { emoji: "🫡", label: "Salute" },
    { emoji: "👀", label: "Eyes" },
    { emoji: "💬", label: "Speech" },
  ]),
  pack("celebration", "stickers.packCelebration", [
    { emoji: "🎉", label: "Party popper" },
    { emoji: "🎊", label: "Confetti" },
    { emoji: "🎈", label: "Balloon" },
    { emoji: "🎁", label: "Gift" },
    { emoji: "🎂", label: "Cake" },
    { emoji: "🍾", label: "Champagne" },
    { emoji: "🥂", label: "Cheers" },
    { emoji: "✨", label: "Sparkles" },
    { emoji: "🔥", label: "Fire" },
    { emoji: "⭐", label: "Star" },
    { emoji: "🌟", label: "Glowing star" },
    { emoji: "💯", label: "Hundred" },
    { emoji: "❤️", label: "Heart" },
    { emoji: "💕", label: "Two hearts" },
    { emoji: "💖", label: "Sparkling heart" },
    { emoji: "💘", label: "Cupido" },
  ]),
];
