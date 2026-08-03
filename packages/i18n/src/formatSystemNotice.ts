import { currentResolvedLocale } from "./formatApiError";
import { translate } from "./messages";

/** Human-readable label for persisted admin-only system notices. */
export function formatSystemNotice(content: string): string {
  const locale = currentResolvedLocale();
  try {
    const parsed = JSON.parse(content) as {
      kind?: string;
      user_name?: string;
      by_name?: string;
    };
    if (parsed.kind === "member_left") {
      return translate(locale, "chat.memberLeft", {
        user: parsed.user_name || translate(locale, "chat.user"),
      });
    }
    if (parsed.kind === "member_removed") {
      return translate(locale, "chat.memberRemoved", {
        user: parsed.user_name || translate(locale, "chat.user"),
        by: parsed.by_name || translate(locale, "chat.user"),
      });
    }
  } catch {
    /* plain body */
  }
  return content;
}
