import { loadLocalNotifyProps } from "@/lib/notifyProps";

/** Count incoming pending friend requests from /v1/friends. */
export function countIncomingPending(friends: Array<{ status?: string; incoming?: boolean }>): number {
  return friends.filter((f) => f.status === "pending" && f.incoming).length;
}

/** Browser/desktop toast when a friend request arrives. */
export function notifyFriendRequest(opts: {
  fromName?: string;
  fromUsername?: string;
}): Notification | null {
  if (typeof window === "undefined" || !("Notification" in window)) return null;
  if (Notification.permission !== "granted") return null;

  const props = loadLocalNotifyProps();
  if (props.desktop === "none") return null;

  const who =
    opts.fromName?.trim() ||
    (opts.fromUsername?.trim() ? `@${opts.fromUsername.trim()}` : "") ||
    "Someone";

  const n = new Notification("Friend request", {
    body: `${who} wants to add you as a contact`,
    tag: "qchat-friend-request",
  });
  n.onclick = () => {
    window.focus();
    window.location.href = "/friends";
    n.close();
  };
  return n;
}
