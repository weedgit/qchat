/** Cross-window call handoff (main chat ↔ pop-out call window). */

export const CALL_HANDOFF_KEY = "qchat.call.handoff";
export const CALL_CHANNEL = "qchat-call";

export type CallHandoffPayload = {
  v: 1;
  callId: string;
  conversationId: string;
  kind: "voice" | "video";
  role: "caller" | "callee";
  isGroup?: boolean;
  isHost?: boolean;
  peerName?: string;
  peerAvatar?: string;
  livekitUrl: string;
  livekitToken: string;
  createdAt: number;
};

export type CallChannelMessage =
  | { type: "popout-ready"; callId: string }
  | { type: "popout-closed"; callId: string }
  | { type: "call-ended"; callId: string }
  | { type: "force-hangup"; callId: string }
  | { type: "focus-popout"; callId: string }
  | { type: "focus-main"; callId: string };

const HANDOFF_TTL_MS = 60_000;

export function writeCallHandoff(payload: CallHandoffPayload): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(CALL_HANDOFF_KEY, JSON.stringify(payload));
}

export function takeCallHandoff(): CallHandoffPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CALL_HANDOFF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CallHandoffPayload;
    if (!parsed || parsed.v !== 1) {
      localStorage.removeItem(CALL_HANDOFF_KEY);
      return null;
    }
    if (!parsed.callId || !parsed.livekitUrl || !parsed.livekitToken) {
      localStorage.removeItem(CALL_HANDOFF_KEY);
      return null;
    }
    if (Date.now() - Number(parsed.createdAt || 0) > HANDOFF_TTL_MS) {
      localStorage.removeItem(CALL_HANDOFF_KEY);
      return null;
    }
    return parsed;
  } catch {
    localStorage.removeItem(CALL_HANDOFF_KEY);
    return null;
  }
}

export function peekCallHandoff(): CallHandoffPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CALL_HANDOFF_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CallHandoffPayload;
  } catch {
    return null;
  }
}

export function clearCallHandoff(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(CALL_HANDOFF_KEY);
}

export function openCallChannel(
  handler: (msg: CallChannelMessage) => void
): () => void {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return () => {};
  }
  const ch = new BroadcastChannel(CALL_CHANNEL);
  ch.onmessage = (ev) => {
    const data = ev?.data as CallChannelMessage | undefined;
    if (!data || typeof data !== "object" || !data.type) return;
    handler(data);
  };
  return () => {
    try {
      ch.close();
    } catch {
      /* ignore */
    }
  };
}

export function postCallChannel(msg: CallChannelMessage): void {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
  try {
    const ch = new BroadcastChannel(CALL_CHANNEL);
    ch.postMessage(msg);
    ch.close();
  } catch {
    /* ignore */
  }
}

/** Open a resizable OS/browser window for /call (Electron preferred). */
export function openCallPopoutWindow(): boolean {
  if (typeof window === "undefined") return false;
  const path = "/call";
  const desk = window.qchatDesktop;
  if (desk?.openCallWindow) {
    void desk.openCallWindow(path);
    return true;
  }
  const url = `${window.location.origin}${path}`;
  const features =
    "popup=yes,width=1100,height=720,left=80,top=60,resizable=yes,scrollbars=no,status=no";
  const w = window.open(url, "qchat-call", features);
  if (!w) return false;
  try {
    w.focus();
  } catch {
    /* ignore */
  }
  return true;
}

export function focusCallPopoutWindow(): void {
  if (typeof window === "undefined") return;
  if (window.qchatDesktop?.focusCallWindow) {
    void window.qchatDesktop.focusCallWindow();
    return;
  }
  const w = window.open("", "qchat-call");
  w?.focus();
}

export function focusMainChatWindow(): void {
  if (typeof window === "undefined") return;
  if (window.qchatDesktop?.focusMainWindow) {
    void window.qchatDesktop.focusMainWindow();
    return;
  }
  if (window.opener && !window.opener.closed) {
    try {
      window.opener.focus();
    } catch {
      /* ignore */
    }
  }
}
