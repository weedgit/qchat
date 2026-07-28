"use client";

import { useState } from "react";
import { emojiToStickerUrl, emojiToTwemojiUrl } from "@/lib/stickerData";

/** Render one emoji as an animated Noto WebP, falling back to Twemoji PNG. */
export function AnimatedEmojiImg({
  emoji,
  className,
  size,
}: {
  emoji: string;
  className?: string;
  size?: number;
}) {
  const [src, setSrc] = useState(() => emojiToStickerUrl(emoji));
  const style = size ? { width: size, height: size } : undefined;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={emoji}
      className={className}
      style={style}
      draggable={false}
      loading="lazy"
      onError={() => {
        const fallback = emojiToTwemojiUrl(emoji);
        if (src !== fallback) setSrc(fallback);
      }}
    />
  );
}

/** Split a short emoji-only message into animated images. */
export function AnimatedEmojiOnlyBody({ text }: { text: string }) {
  const tokens =
    typeof Intl !== "undefined" && "Segmenter" in Intl
      ? Array.from(
          new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text.trim()),
          (s) => s.segment
        ).filter((g) => g.trim().length > 0)
      : Array.from(text.trim());

  return (
    <div
      className={`emoji-only-body emoji-count-${Math.min(Math.max(tokens.length, 1), 3)}`}
    >
      {tokens.map((em, i) => (
        <AnimatedEmojiImg key={`${i}-${em}`} emoji={em} className="emoji-only-img" />
      ))}
    </div>
  );
}
