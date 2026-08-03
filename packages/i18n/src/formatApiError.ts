import {
  LOCALE_KEY,
  normalizeLocaleMode,
  resolveLocale,
  translate,
  type MessageKey,
  type ResolvedLocale,
} from "./messages";

/** Minimal shape shared by web/mobile ApiError. */
export type ApiErrorLike = {
  status?: number;
  code?: string;
  message?: string;
  fields?: Record<string, string>;
};

type TranslateFn = (key: MessageKey, vars?: Record<string, string | number>) => string;

const CODE_TO_KEY: Record<string, MessageKey> = {
  invalid_invite: "login.errInvalidInvite",
  invite_required: "login.inviteRequired",
  login_locked: "login.errLocked",
  no_enterprise: "login.errNoEnterprise",
  phone_taken: "login.errPhoneTaken",
  invalid_refresh: "api.err.unauthorized",
  refresh_reused: "api.err.unauthorized",
  unauthorized: "api.err.unauthorized",
  forbidden: "api.err.forbidden",
  not_found: "api.err.notFound",
  user_not_found: "api.err.userNotFound",
  conflict: "api.err.conflict",
  invalid_request: "api.err.invalidRequest",
  invalid_json: "api.err.invalidJson",
  invalid_captcha: "login.errInvalidCaptcha",
  invalid_credentials: "login.errInvalidCredentials",
  invalid_password: "api.err.incorrectPassword",
  password_required: "api.err.passwordRequired",
  invalid_username: "login.errUsernameInvalid",
  invalid_display_name: "me.displayNameTaken",
  query_failed: "api.err.server",
  update_failed: "api.err.updateFailed",
  create_failed: "api.err.createFailed",
  delete_failed: "api.err.deleteFailed",
  request_failed: "login.requestFailed",
  request_not_found: "api.err.notFound",
  session_failed: "api.err.server",
  not_friends: "api.err.notFriends",
  blocked: "api.err.blocked",
  friend_closed: "api.err.friendClosed",
  cannot_add_self: "api.err.cannotAddSelf",
  friend_limit: "api.err.friendLimit",
  group_full: "api.err.groupFull",
  group_forbid_friend: "api.err.groupForbidFriend",
  call_in_progress: "api.err.callInProgress",
  invalid_role: "api.err.invalidRequest",
  member_count_failed: "api.err.server",
  block_failed: "api.err.updateFailed",
};

const MESSAGE_TO_KEY: Array<[RegExp, MessageKey]> = [
  [/invalid captcha/i, "login.errInvalidCaptcha"],
  [/invalid credentials/i, "login.errInvalidCredentials"],
  [/invalid invite/i, "login.errInvalidInvite"],
  [/invite code required/i, "login.inviteRequired"],
  [/phone must be/i, "login.errPhone"],
  [/password must be|at least 8/i, "login.errPassword"],
  [/incorrect password/i, "api.err.incorrectPassword"],
  [/password required/i, "api.err.passwordRequired"],
  [/invalid username/i, "login.errUsernameInvalid"],
  [/account banned/i, "login.errBanned"],
  [/phone or username already exists|already (exists|taken|in use)/i, "api.err.conflict"],
  [/phone already/i, "login.errPhoneTaken"],
  [/username already/i, "login.errUsernameTaken"],
  [/display name already/i, "me.displayNameTaken"],
  [/enterprise required/i, "login.errNoEnterprise"],
  [/too many failed/i, "login.errLocked"],
  [/network error|failed to fetch|load failed/i, "api.err.network"],
  [/upload aborted/i, "api.err.uploadAborted"],
  [/upload failed/i, "api.err.uploadFailed"],
  [/file too large|too large/i, "api.err.fileTooLarge"],
  [/file not allowed/i, "api.err.fileNotAllowed"],
  [/not friends/i, "api.err.notFriends"],
  [/cannot message/i, "api.err.blocked"],
  [/user not found/i, "api.err.userNotFound"],
  [/group not found/i, "api.err.notFound"],
  [/forbidden/i, "api.err.forbidden"],
  [/unauthorized|session expired/i, "api.err.unauthorized"],
  [/not found/i, "api.err.notFound"],
  [/invalid json/i, "api.err.invalidJson"],
  [/query failed|create failed|update failed|delete failed|hash failed|session failed/i, "api.err.server"],
  [/request failed/i, "login.requestFailed"],
];

function asApiError(err: unknown): ApiErrorLike | null {
  if (!err || typeof err !== "object") return null;
  const e = err as Record<string, unknown>;
  if (typeof e.message !== "string" && typeof e.code !== "string" && typeof e.status !== "number") {
    return null;
  }
  return {
    status: typeof e.status === "number" ? e.status : undefined,
    code: typeof e.code === "string" ? e.code : undefined,
    message: typeof e.message === "string" ? e.message : undefined,
    fields:
      e.fields && typeof e.fields === "object"
        ? (e.fields as Record<string, string>)
        : undefined,
  };
}

function keyFromFields(fields: Record<string, string>): MessageKey | null {
  for (const [k, v] of Object.entries(fields)) {
    const val = String(v).toLowerCase();
    if (k === "phone" || k === "new_phone") return "login.errPhoneTaken";
    if (k === "username" && (val.includes("taken") || val.includes("exist"))) {
      return "login.errUsernameTaken";
    }
    if (k === "username") return "login.errUsernameInvalid";
    if (k === "display_name") return "me.displayNameTaken";
  }
  return null;
}

function keyFromStatus(status?: number): MessageKey | null {
  if (status === 0) return "api.err.network";
  if (status === 401) return "api.err.unauthorized";
  if (status === 403) return "api.err.forbidden";
  if (status === 404) return "api.err.notFound";
  if (status === 409) return "api.err.conflict";
  if (status === 413) return "api.err.fileTooLarge";
  if (status === 429) return "login.errLocked";
  if (status !== undefined && status >= 500) return "api.err.server";
  return null;
}

/** Resolve the best MessageKey for an API/network error (never returns raw English). */
export function apiErrorMessageKey(err: unknown, fallback: MessageKey = "common.error"): MessageKey {
  const e = asApiError(err);
  if (!e) {
    if (err && typeof err === "object" && "message" in err) {
      const msg = String((err as { message?: string }).message || "");
      for (const [re, key] of MESSAGE_TO_KEY) {
        if (re.test(msg)) return key;
      }
    }
    return fallback;
  }

  if (e.code && CODE_TO_KEY[e.code]) return CODE_TO_KEY[e.code];
  if (e.fields) {
    const fromFields = keyFromFields(e.fields);
    if (fromFields) return fromFields;
  }
  if (e.message) {
    for (const [re, key] of MESSAGE_TO_KEY) {
      if (re.test(e.message)) return key;
    }
  }
  const fromStatus = keyFromStatus(e.status);
  if (fromStatus) return fromStatus;
  return fallback;
}

/** Format an error for UI using the caller's `t` translator. */
export function formatApiError(
  err: unknown,
  t: TranslateFn,
  fallback: MessageKey = "common.error"
): string {
  return t(apiErrorMessageKey(err, fallback));
}

export function currentResolvedLocale(): ResolvedLocale {
  if (typeof localStorage === "undefined") return "zh";
  return resolveLocale(normalizeLocaleMode(localStorage.getItem(LOCALE_KEY)));
}

/** Format without a React `t` — reads locale from localStorage (web) or defaults to zh. */
export function formatApiErrorLocale(
  err: unknown,
  locale?: ResolvedLocale,
  fallback: MessageKey = "common.error"
): string {
  const resolved = locale ?? currentResolvedLocale();
  return translate(resolved, apiErrorMessageKey(err, fallback));
}
