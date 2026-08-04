/** Admin console role → capability helpers (mirror API admin_rbac.go). */

export type ConsoleRole = "platform_admin" | "enterprise_admin" | "member" | string;

export type AdminCapability =
  | "read"
  | "inspectMessages"
  | "createMember"
  | "resetPassword"
  | "revokeSession"
  | "ban"
  | "manageInvite"
  | "writeEnterprise"
  | "writeSecurity"
  | "issueEnterpriseAdmin"
  | "manageBackup";

function normalizeRole(role: string): string {
  if (role === "platform_owner") return "platform_admin";
  if (role === "compliance" || role === "support" || role === "read_only") return "member";
  return role;
}

const MATRIX: Record<string, AdminCapability[]> = {
  platform_admin: [
    "read",
    "inspectMessages",
    "createMember",
    "resetPassword",
    "revokeSession",
    "ban",
    "manageInvite",
    "writeEnterprise",
    "writeSecurity",
    "issueEnterpriseAdmin",
    "manageBackup",
  ],
  enterprise_admin: [
    "read",
    "inspectMessages",
    "createMember",
    "resetPassword",
    "revokeSession",
    "ban",
    "manageInvite",
    "writeEnterprise",
    "writeSecurity",
  ],
};

export function isConsoleRole(role: string): boolean {
  return Object.prototype.hasOwnProperty.call(MATRIX, normalizeRole(role));
}

export function can(role: string, cap: AdminCapability): boolean {
  return (MATRIX[normalizeRole(role)] ?? []).includes(cap);
}

export function isPlatformAdmin(role: string): boolean {
  return normalizeRole(role) === "platform_admin";
}
