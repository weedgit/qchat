import { formatApiError, type MessageKey } from "@qchat/i18n";
import { ApiError } from "./api";

/** Map API/network errors to localized admin strings. */
export function formatAdminError(
  err: unknown,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
  fallback: MessageKey = "admin.err.generic"
): string {
  if (err instanceof ApiError) {
    const body = (err.body ?? {}) as Record<string, unknown>;
    return formatApiError(
      {
        status: err.status,
        code: typeof body.code === "string" ? body.code : undefined,
        message: err.message,
        fields:
          body.fields && typeof body.fields === "object"
            ? (body.fields as Record<string, string>)
            : undefined,
      },
      t,
      fallback
    );
  }
  return formatApiError(err, t, fallback);
}
