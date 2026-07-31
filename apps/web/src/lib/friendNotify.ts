import { isQchatDesktop } from "@/lib/device";
import { loadLocalNotifyProps } from "@/lib/notifyProps";

/** Count incoming pending friend requests from /v1/friends. */
export function countIncomingPending(friends: Array<{ status?: string; incoming?: boolean }>): number {
  return friends.filter((f) => f.status === "pending" && f.incoming).length;
}

/** Sentinel conversation id — desktop toast click opens Contacts. */
export const FRIENDS_NOTIFY_CONV_ID = "__friends__";

/** Browser/desktop OS notification when a friend request arrives. */
export function notifyFriendRequest(opts: {
  fromName?: string;
  fromUsername?: string;
}): Notification | null {
  const props = loadLocalNotifyProps();
  if (props.desktop === "none") return null;

  const who =
    opts.fromName?.trim() ||
    (opts.fromUsername?.trim() ? `@${opts.fromUsername.trim()}` : "") ||
    "Someone";
  const title = "Friend request";
  const body = `${who} wants to add you as a contact`;

  // Desktop: Electron IPC (browser Notification is unreliable when unfocused).
  if (isQchatDesktop() && window.qchatDesktop?.notifyMessage) {
    void window.qchatDesktop
      .notifyMessage({
        title,
        body,
        conversationId: FRIENDS_NOTIFY_CONV_ID,
        silent: !props.sound,
        mention: true,
        suppressIfFocused: false,
      })
      .catch((err) => {
        console.error("[qchat] desktop friend-request notify failed:", err);
      });
    return null;
  }

  if (typeof window === "undefined" || !("Notification" in window)) return null;
  if (Notification.permission !== "granted") return null;

  const n = new Notification(title, {
    body,
    tag: "qchat-friend-request",
    silent: !props.sound,
  });
  n.onclick = () => {
    window.focus();
    window.location.href = "/friends";
    n.close();
  };
  return n;
}
