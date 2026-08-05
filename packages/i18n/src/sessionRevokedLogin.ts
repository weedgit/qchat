import type { MessageKey } from "./messages";

/** Login-screen error for a stored session.revoked reason (null = no banner). */
export function sessionRevokedLoginMessageKey(reason: string): MessageKey | null {
  switch (reason) {
    case "logout":
      return null;
    case "banned":
      return "login.errBanned";
    case "replaced":
      return "login.errSignedOut";
    default:
      return "login.errSignedOut";
  }
}
