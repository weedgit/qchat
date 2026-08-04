import type { MessageKey } from "@qchat/i18n";
import { formatSystemNotice } from "@qchat/i18n";

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Localize call duration fragments like "17s", "1m", "1m 5s". */
function localizeDuration(raw: string, t: Translate): string {
  const trimmed = raw.trim();
  const minSec = trimmed.match(/^(\d+)m\s+(\d+)s$/i);
  if (minSec) {
    return t("chat.durationMinSec", { m: Number(minSec[1]), s: Number(minSec[2]) });
  }
  const minOnly = trimmed.match(/^(\d+)m$/i);
  if (minOnly) return t("chat.durationMin", { n: Number(minOnly[1]) });
  const secOnly = trimmed.match(/^(\d+)s$/i);
  if (secOnly) return t("chat.durationSec", { n: Number(secOnly[1]) });
  return trimmed;
}

/**
 * Map stored English system/media labels to the active locale.
 * Message bodies stay English in the DB; display is localized on the client.
 */
export function localizeChatLabel(
  text: string | undefined | null,
  t: Translate,
  opts?: { type?: string }
): string {
  const raw = (text ?? "").trim();
  const type = opts?.type;

  if (!raw) {
    if (type === "voice") return t("chat.voiceMessage");
    if (type === "image") return t("chat.photo");
    if (type === "file") return t("chat.file");
    if (type === "call") return t("chat.call");
    return "";
  }

  if (raw.startsWith("{") && (raw.includes("member_left") || raw.includes("member_removed"))) {
    return formatSystemNotice(raw);
  }

  const voiceTimed = raw.match(/^Voice message \((.+)\)$/i);
  if (voiceTimed) return t("chat.voiceMessageTimed", { time: voiceTimed[1] });
  if (/^Voice message$/i.test(raw)) return t("chat.voiceMessage");
  if (/^Photo$/i.test(raw)) return t("chat.photo");
  if (/^File$/i.test(raw)) return t("chat.file");
  if (/^Attachment$/i.test(raw)) return t("chat.attachment");
  if (/^New message$/i.test(raw)) return t("chat.newMessage");
  if (/^Message recalled$/i.test(raw)) return t("chat.messageRecalled");
  if (/^Message$/i.test(raw)) return t("chat.message");
  if (/^Call$/i.test(raw)) return t("chat.call");

  if (/^Missed Voice call$/i.test(raw)) return t("chat.missedVoiceCall");
  if (/^Missed Video call$/i.test(raw)) return t("chat.missedVideoCall");
  if (/^Voice call cancelled$/i.test(raw)) return t("chat.voiceCallCancelled");
  if (/^Video call cancelled$/i.test(raw)) return t("chat.videoCallCancelled");
  if (/^Voice call declined$/i.test(raw)) return t("chat.voiceCallDeclined");
  if (/^Video call declined$/i.test(raw)) return t("chat.videoCallDeclined");
  if (/^Voice call ended$/i.test(raw)) return t("chat.voiceCallEnded");
  if (/^Video call ended$/i.test(raw)) return t("chat.videoCallEnded");

  const voiceDur = raw.match(/^Voice call · (.+)$/i);
  if (voiceDur) {
    return t("chat.voiceCallDuration", { duration: localizeDuration(voiceDur[1], t) });
  }
  const videoDur = raw.match(/^Video call · (.+)$/i);
  if (videoDur) {
    return t("chat.videoCallDuration", { duration: localizeDuration(videoDur[1], t) });
  }

  return raw;
}

/** True when content is the English default photo caption (not a real caption). */
export function isDefaultPhotoLabel(text: string | undefined | null): boolean {
  return !text || /^Photo$/i.test(text.trim());
}

/** Built-in sticker/GIF captions from the composer picker (not user-written). */
export function isStickerOrGifCaption(text: string | undefined | null): boolean {
  return /^(Sticker|GIF)$/i.test((text ?? "").trim());
}

/** Hide default machine captions for photo / sticker / GIF image messages. */
export function isDefaultImageCaption(text: string | undefined | null): boolean {
  return isDefaultPhotoLabel(text) || isStickerOrGifCaption(text);
}

/**
 * True when the message body is only emoji (no letters/digits/punctuation).
 * Caps at a few tokens so short reactions get large bare styling.
 */
export function isEmojiOnlyText(text: string | undefined | null, max = 3): boolean {
  const raw = (text ?? "").trim();
  if (!raw) return false;

  // BMP symbols + astral emoji (surrogate pairs), optional ZWJ sequences / skin tones.
  // Avoid Unicode property escapes / `u` flag — web tsconfig defaults below ES6.
  const emojiToken =
    /(?:\u00a9|\u00ae|[\u203c\u2049\u2122\u2139\u2194-\u2199\u21a9\u21aa\u231a\u231b\u2328\u23cf\u23e9-\u23f3\u23f8-\u23fa\u24c2\u25aa\u25ab\u25b6\u25c0\u25fb-\u25fe\u2600-\u27bf\u2934\u2935\u2b05-\u2b07\u2b1b\u2b1c\u2b50\u2b55\u3030\u303d\u3297\u3299]|\ud83c[\udc00-\udfff]|\ud83d[\udc00-\udfff]|\ud83e[\udc00-\udfff])(?:\ufe0f)?(?:\u200d(?:\u00a9|\u00ae|[\u203c\u2049\u2122\u2139\u2194-\u2199\u21a9\u21aa\u231a\u231b\u2328\u23cf\u23e9-\u23f3\u23f8-\u23fa\u24c2\u25aa\u25ab\u25b6\u25c0\u25fb-\u25fe\u2600-\u27bf\u2934\u2935\u2b05-\u2b07\u2b1b\u2b1c\u2b50\u2b55\u3030\u303d\u3297\u3299]|\ud83c[\udc00-\udfff]|\ud83d[\udc00-\udfff]|\ud83e[\udc00-\udfff])(?:\ufe0f)?)*(?:\ud83c[\udffb-\udfff])?/g;

  const matches = raw.match(emojiToken);
  if (!matches || matches.length === 0 || matches.length > max) return false;

  const rest = raw
    .replace(emojiToken, "")
    .replace(/[\ufe0f\u200d\u20e3]/g, "")
    .replace(/\s+/g, "");
  return rest.length === 0;
}
