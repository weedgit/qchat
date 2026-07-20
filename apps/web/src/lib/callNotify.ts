import { loadLocalNotifyProps } from "@/lib/notifyProps";
import { startCallRing, stopCallRing } from "@/lib/callRing";

/** Mattermost DID_NOTIFY_FOR_CALL — OS notification when tab is backgrounded. */
export function notifyIncomingCall(opts: {
  callId: string;
  conversationId: string;
  kind: "voice" | "video";
  initiatorName?: string;
}): Notification | null {
  if (typeof window === "undefined" || !("Notification" in window)) return null;
  if (Notification.permission !== "granted") return null;

  const props = loadLocalNotifyProps();
  if (props.desktop === "none") return null;

  // Mattermost: desktop notify only when document is hidden.
  if (document.visibilityState !== "hidden" && !document.hidden) return null;

  const who = opts.initiatorName?.trim() || "Someone";
  const kindLabel = opts.kind === "video" ? "Video" : "Voice";
  const n = new Notification(`Incoming ${kindLabel} call`, {
    body: `${who} is calling`,
    tag: `qchat-call-${opts.callId}`,
    silent: !props.sound,
  });
  n.onclick = () => {
    window.focus();
    n.close();
  };
  return n;
}

/** Start ringtone if notify sound is enabled (Mattermost ringForCall). */
export function ringForIncomingCall(): void {
  const props = loadLocalNotifyProps();
  if (!props.sound) return;
  startCallRing();
}

export function clearIncomingCallAlerts(notification?: Notification | null): void {
  stopCallRing();
  try {
    notification?.close();
  } catch {
    /* ignore */
  }
}
