/** user notify_props helpers. */
export type NotifyProps = {
  desktop: "all" | "mention" | "none";
  sound: boolean;
  mentions_only: boolean;
};

const KEY = "qchat.notify_props";

export const DEFAULT_NOTIFY: NotifyProps = {
  desktop: "all",
  sound: true,
  mentions_only: false,
};

export function loadLocalNotifyProps(): NotifyProps {
  if (typeof window === "undefined") return DEFAULT_NOTIFY;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_NOTIFY;
    return { ...DEFAULT_NOTIFY, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_NOTIFY;
  }
}

export function saveLocalNotifyProps(props: NotifyProps) {
  localStorage.setItem(KEY, JSON.stringify(props));
}

export function shouldNotifyDesktop(
  props: NotifyProps,
  opts: { muted?: boolean; isMention?: boolean }
): boolean {
  if (opts.muted) return false;
  if (props.desktop === "none") return false;
  if (props.desktop === "mention" || props.mentions_only) return Boolean(opts.isMention);
  return true;
}

/**
 * Whether the UI should raise an OS / desktop toast for an incoming message.
 *
 * Electron often keeps `document.hidden === false` after Alt+Tab while the
 * window is still visible, so rely on `document.hasFocus()` as well. Skip only
 * when the user is focused on that conversation (page visible + focused).
 */
export function shouldAlertIncomingMessage(
  conversationId: string,
  activeConversationId: string | null | undefined
): boolean {
  if (!conversationId) return false;
  if (activeConversationId !== conversationId) return true;
  if (typeof document === "undefined") return false;
  if (document.hidden) return true;
  if (typeof document.hasFocus === "function" && !document.hasFocus()) return true;
  return false;
}
