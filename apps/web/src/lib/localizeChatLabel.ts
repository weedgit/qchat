import type { MessageKey } from "@qchat/i18n";

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
