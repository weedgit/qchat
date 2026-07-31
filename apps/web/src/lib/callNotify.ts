import { isQchatDesktop } from "@/lib/device";
import { loadLocalNotifyProps } from "@/lib/notifyProps";
import { startCallRing, stopCallRing } from "@/lib/callRing";

/** DID_NOTIFY_FOR_CALL — OS notification when the shell is backgrounded. */
export function notifyIncomingCall(opts: {
  callId: string;
  conversationId: string;
  kind: "voice" | "video";
  initiatorName?: string;
}): Notification | null {
  const props = loadLocalNotifyProps();
  if (props.desktop === "none") return null;

  const who = opts.initiatorName?.trim() || "Someone";
  const kindLabel = opts.kind === "video" ? "Video" : "Voice";
  const title = `Incoming ${kindLabel} call`;
  const body = `${who} is calling`;

  // Desktop: use Electron IPC. Page Visibility stays "visible" when the window
  // is unfocused (not minimized), so browser Notification would never fire —
  // while call-cancel system messages still toast via notifyMessage.
  if (isQchatDesktop() && window.qchatDesktop?.notifyMessage) {
    void window.qchatDesktop
      .notifyMessage({
        title,
        body,
        conversationId: opts.conversationId,
        silent: !props.sound,
        // Flash taskbar / Dock so a ringing call is hard to miss.
        mention: true,
        suppressIfFocused: false,
      })
      .catch((err) => {
        console.error("[qchat] desktop incoming-call notify failed:", err);
      });
    return null;
  }

  if (typeof window === "undefined" || !("Notification" in window)) return null;
  if (Notification.permission !== "granted") return null;

  // Browser: only when the tab is backgrounded.
  if (document.visibilityState !== "hidden" && !document.hidden) return null;

  const n = new Notification(title, {
    body,
    tag: `qchat-call-${opts.callId}`,
    silent: !props.sound,
  });
  n.onclick = () => {
    window.focus();
    n.close();
  };
  return n;
}

/** Start ringtone if notify sound is enabled (callee). */
export function ringForIncomingCall(): void {
  const props = loadLocalNotifyProps();
  if (!props.sound) return;
  startCallRing("incoming");
}

/** Ringback while the caller waits for answer / first peer (phone-style). */
export function ringForOutgoingCall(): void {
  const props = loadLocalNotifyProps();
  if (!props.sound) return;
  startCallRing("outgoing");
}

export function clearIncomingCallAlerts(notification?: Notification | null): void {
  stopCallRing();
  try {
    notification?.close();
  } catch {
    /* ignore */
  }
}
