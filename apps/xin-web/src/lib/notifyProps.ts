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
