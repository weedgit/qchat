/** Admin console role → capability helpers (mirror API admin_rbac.go). */

export type ConsoleRole =
  | "platform_owner"
  | "enterprise_admin"
  | "compliance"
  | "support"
  | "read_only"
  | string;

export type AdminCapability =
  | "read"
  | "inspectMessages"
  | "createMember"
  | "createConsoleRole"
  | "resetPassword"
  | "revokeSession"
  | "ban"
  | "manageInvite"
  | "writeEnterprise"
  | "writeSecurity"
  | "issueEnterpriseAdmin";

const MATRIX: Record<string, AdminCapability[]> = {
  platform_owner: [
    "read",
    "inspectMessages",
    "createMember",
    "createConsoleRole",
    "resetPassword",
    "revokeSession",
    "ban",
    "manageInvite",
    "writeEnterprise",
    "writeSecurity",
    "issueEnterpriseAdmin",
  ],
  enterprise_admin: [
    "read",
    "inspectMessages",
    "createMember",
    "createConsoleRole",
    "resetPassword",
    "revokeSession",
    "ban",
    "manageInvite",
    "writeEnterprise",
    "writeSecurity",
  ],
  compliance: ["read", "inspectMessages"],
  support: ["read", "createMember", "resetPassword", "revokeSession"],
  read_only: ["read"],
};

export function isConsoleRole(role: string): boolean {
  return Object.prototype.hasOwnProperty.call(MATRIX, role);
}

export function can(role: string, cap: AdminCapability): boolean {
  return (MATRIX[role] ?? []).includes(cap);
}
