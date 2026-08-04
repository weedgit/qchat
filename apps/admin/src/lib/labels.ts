import type { MessageKey } from "@qchat/i18n";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function displayEnterpriseName(name: string, inviteCode?: string): string {
  const code = inviteCode?.trim();
  if (code) {
    const suffix = ` (${code})`;
    if (name.endsWith(suffix)) return name.slice(0, -suffix.length);
  }
  return name;
}

export function translateGroupMemberRole(t: T, role: string): string {
  if (role === "owner") return t("admin.groupRole.owner");
  if (role === "admin") return t("admin.groupRole.admin");
  if (role === "member") return t("admin.groupRole.member");
  return role;
}

export function translateGroupStatus(t: T, status: string): string {
  if (status === "active") return t("admin.status.active");
  if (status === "deleted") return t("admin.status.deleted");
  return status;
}

export function translateUserStatus(t: T, status: string): string {
  if (status === "active") return t("admin.status.active");
  if (status === "banned") return t("admin.status.banned");
  return status;
}

export function translateInviteStatus(t: T, active: boolean): string {
  return active ? t("admin.status.active") : t("admin.status.revoked");
}

export function translateSessionStatus(t: T, status: string): string {
  if (status === "active") return t("admin.sessionStatus.active");
  if (status === "expired") return t("admin.sessionStatus.expired");
  if (status === "revoked") return t("admin.sessionStatus.revoked");
  return status;
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

const AUDIT_ACTION_KEYS: Record<string, MessageKey> = {
  "enterprise.create": "admin.auditAction.enterprise.create",
  "enterprise.join": "admin.auditAction.enterprise.join",
  "enterprise.retention": "admin.auditAction.enterprise.retention",
  "retention.run": "admin.auditAction.retention.run",
  "invite.rotate": "admin.auditAction.invite.rotate",
  "invite.revoke": "admin.auditAction.invite.revoke",
  "invite.activate": "admin.auditAction.invite.activate",
  "user.create": "admin.auditAction.user.create",
  "user.register": "admin.auditAction.user.register",
  "user.ban": "admin.auditAction.user.ban",
  "user.reset_password": "admin.auditAction.user.reset_password",
  "user.profile_update": "admin.auditAction.user.profile_update",
  "user.phone_change": "admin.auditAction.user.phone_change",
  "user.session_revoke": "admin.auditAction.user.session_revoke",
  "user.mfa_setup": "admin.auditAction.user.mfa_setup",
  "user.mfa_enable": "admin.auditAction.user.mfa_enable",
  "user.mfa_disable": "admin.auditAction.user.mfa_disable",
  "user.mfa_recovery_regenerate": "admin.auditAction.user.mfa_recovery_regenerate",
  "user.mfa_recovery_used": "admin.auditAction.user.mfa_recovery_used",
  "group.create": "admin.auditAction.group.create",
  "group.delete": "admin.auditAction.group.delete",
  "group.member_add": "admin.auditAction.group.member_add",
  "group.member_remove": "admin.auditAction.group.member_remove",
  "group.join_request": "admin.auditAction.group.join_request",
  "group.join_approve": "admin.auditAction.group.join_approve",
  "group.admin_appoint": "admin.auditAction.group.admin_appoint",
  "group.admin_demote": "admin.auditAction.group.admin_demote",
  "group.mute_all": "admin.auditAction.group.mute_all",
  "group.unmute": "admin.auditAction.group.unmute",
  "group.mute": "admin.auditAction.group.mute",
  "contact.request": "admin.auditAction.contact.request",
  "contact.accept": "admin.auditAction.contact.accept",
  "user_log.retention": "admin.auditAction.user_log.retention",
  "backup.settings": "admin.auditAction.backup.settings",
  "backup.run": "admin.auditAction.backup.run",
  "backup.restore": "admin.auditAction.backup.restore",
  "admin.ip_allowlist_add": "admin.auditAction.admin.ip_allowlist_add",
  "admin.ip_allowlist_remove": "admin.auditAction.admin.ip_allowlist_remove",
};

const USER_LOG_PLATFORM_KEYS: Record<string, MessageKey> = {
  desktop: "admin.userLog.platform.desktop",
  mobile: "admin.userLog.platform.mobile",
  web: "admin.userLog.platform.web",
  admin_console: "admin.userLog.platform.adminConsole",
};

export function auditActionLabel(t: T, action: string): string {
  const key = AUDIT_ACTION_KEYS[action];
  return key ? t(key) : action.replace(/[._]/g, " ");
}

export function userLogPlatformLabel(t: T, platform: string): string {
  const key = USER_LOG_PLATFORM_KEYS[platform];
  return key ? t(key) : platform;
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
