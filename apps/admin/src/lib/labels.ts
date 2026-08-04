import type { MessageKey } from "@qchat/i18n";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function translateUserStatus(t: T, status: string): string {
  if (status === "active") return t("admin.status.active");
  if (status === "banned") return t("admin.status.banned");
  return status;
}

export function translateInviteStatus(t: T, active: boolean): string {
  return active ? t("admin.status.active") : t("admin.status.revoked");
}

export function translateRole(t: T, role: string): string {
  const normalized =
    role === "platform_owner"
      ? "platform_admin"
      : role === "compliance" || role === "support" || role === "read_only"
        ? "member"
        : role;
  const key = `admin.role.${normalized}` as MessageKey;
  const known = ["member", "enterprise_admin", "platform_admin"];
  if (known.includes(normalized)) return t(key);
  return role;
}

export function securityAlertKey(action: string): MessageKey | null {
  switch (action) {
    case "admin.login_new_device":
      return "admin.security.alertNewDevice";
    case "admin.login_new_ip":
      return "admin.security.alertNewIp";
    case "user.login_denied_ip":
      return "admin.security.alertIpBlocked";
    default:
      return null;
  }
}

export function securityAlertLabel(t: T, action: string): string {
  const key = securityAlertKey(action);
  return key ? t(key) : action;
}

export function backupDrStatus(
  t: T,
  data: { ok?: boolean; configured?: boolean } | null | undefined
): string {
  if (data == null) return t("admin.common.none");
  if (data.ok) return t("admin.backup.statusOk");
  if (data.configured) return t("admin.backup.statusWarn");
  return t("admin.backup.statusNone");
}

export function yesNo(t: T, value: boolean): string {
  return value ? t("admin.common.yes") : t("admin.common.no");
}
