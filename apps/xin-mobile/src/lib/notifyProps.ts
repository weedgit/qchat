/** Local notify_props helpers — in-memory cache + SecureStore for mobile OS banners. */
import * as SecureStore from "expo-secure-store";

export type NotifyProps = {
  desktop: "all" | "mention" | "none";
  sound: boolean;
  mentions_only: boolean;
};

const KEY = "xinchat.notify_props";

export const DEFAULT_NOTIFY: NotifyProps = {
  desktop: "all",
  sound: true,
  mentions_only: false,
};

/** Live prefs used by ChatContext (avoids stale SecureStore / forgotten Save). */
let cached: NotifyProps = { ...DEFAULT_NOTIFY };

export function getNotifyProps(): NotifyProps {
  return cached;
}

export function normalizeNotifyProps(raw: any): NotifyProps {
  const desktop =
    raw?.desktop === "mention" || raw?.desktop === "none" ? raw.desktop : "all";
  return {
    desktop,
    sound: raw?.sound !== false,
    // desktop=mention always implies mentions_only; otherwise honor the flag.
    mentions_only: desktop === "mention" ? true : Boolean(raw?.mentions_only),
  };
}

/** Align desktop ↔ mentions_only when either control changes. */
export function withDesktop(props: NotifyProps, desktop: NotifyProps["desktop"]): NotifyProps {
  return {
    ...props,
    desktop,
    mentions_only: desktop === "mention" ? true : desktop === "all" ? false : props.mentions_only,
  };
}

export function withMentionsOnly(props: NotifyProps, mentions_only: boolean): NotifyProps {
  if (mentions_only) {
    return { ...props, mentions_only: true, desktop: props.desktop === "none" ? "none" : "mention" };
  }
  return {
    ...props,
    mentions_only: false,
    desktop: props.desktop === "mention" ? "all" : props.desktop,
  };
}

export async function loadLocalNotifyProps(): Promise<NotifyProps> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) {
      cached = { ...DEFAULT_NOTIFY };
      return cached;
    }
    cached = normalizeNotifyProps(JSON.parse(raw));
    return cached;
  } catch {
    cached = { ...DEFAULT_NOTIFY };
    return cached;
  }
}

export async function saveLocalNotifyProps(props: NotifyProps): Promise<void> {
  cached = normalizeNotifyProps(props);
  await SecureStore.setItemAsync(KEY, JSON.stringify(cached));
}

export function shouldNotify(
  props: NotifyProps,
  opts: { muted?: boolean; isMention?: boolean }
): boolean {
  if (opts.muted) return false;
  if (props.desktop === "none") return false;
  if (props.desktop === "mention" || props.mentions_only) {
    return Boolean(opts.isMention);
  }
  return true;
}
