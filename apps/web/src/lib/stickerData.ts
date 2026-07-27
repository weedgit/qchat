/** Built-in sticker packs (Twemoji PNGs). No user-uploaded custom packs. */

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

/** Map an emoji to a Twemoji 72×72 PNG on jsDelivr. */
export function emojiToTwemojiUrl(emoji: string): string {
  const hex = [...emoji]
    .map((ch) => ch.codePointAt(0))
    .filter((cp): cp is number => typeof cp === "number" && cp !== 0xfe0f)
    .map((cp) => cp.toString(16))
    .join("-");
  return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${hex}.png`;
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
      url: emojiToTwemojiUrl(it.emoji),
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
