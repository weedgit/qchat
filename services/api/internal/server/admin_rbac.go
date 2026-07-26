package server

import (
	"net/http"

	"github.com/qchat/qchat/services/api/internal/auth"
)

// Console / admin-console roles (requirements-en §5 recommended RBAC).
const (
	rolePlatformOwner   = "platform_owner"
	roleEnterpriseAdmin = "enterprise_admin"
	roleCompliance      = "compliance"
	roleSupport         = "support"
	roleReadOnly        = "read_only"
	roleMember          = "member"
)

// Permission keys enforced by requirePerm.
const (
	permAdminRead            = "admin.read"
	permMessagesInspect      = "admin.messages.inspect"
	permUsersCreateMember    = "admin.users.create_member"
	permUsersCreateSubrole   = "admin.users.create_console_role"
	permUsersResetPassword   = "admin.users.reset_password"
	permUsersRevokeSession   = "admin.users.revoke_session"
	permUsersBan             = "admin.users.ban"
	permInviteManage         = "admin.invite.manage"
	permEnterpriseWrite      = "admin.enterprise.write"
	permSecurityWrite        = "admin.security.write"
	permRetention            = "admin.retention"
	permIssueEnterpriseAdmin = "admin.issue_enterprise_admin"
)

var rolePerms = map[string]map[string]bool{
	rolePlatformOwner: {
		permAdminRead: true, permMessagesInspect: true,
		permUsersCreateMember: true, permUsersCreateSubrole: true,
		permUsersResetPassword: true, permUsersRevokeSession: true, permUsersBan: true,
		permInviteManage: true, permEnterpriseWrite: true, permSecurityWrite: true,
		permRetention: true, permIssueEnterpriseAdmin: true,
	},
	roleEnterpriseAdmin: {
		permAdminRead: true, permMessagesInspect: true,
		permUsersCreateMember: true, permUsersCreateSubrole: true,
		permUsersResetPassword: true, permUsersRevokeSession: true, permUsersBan: true,
		permInviteManage: true, permEnterpriseWrite: true, permSecurityWrite: true,
		permRetention: true,
	},
	roleCompliance: {
		permAdminRead: true, permMessagesInspect: true,
	},
	roleSupport: {
		permAdminRead:          true,
		permUsersCreateMember:  true,
		permUsersResetPassword: true, permUsersRevokeSession: true,
	},
	roleReadOnly: {
		permAdminRead: true,
	},
}

// isAdminRole reports whether the account is an admin-console principal
// (full admins plus compliance/support/read-only subaccounts). Used for MFA,
// IP allowlist, and login-alert enrollment.
func isAdminRole(role string) bool {
	_, ok := rolePerms[role]
	return ok
}

func roleHasPerm(role, perm string) bool {
	return rolePerms[role][perm]
}

// requireAdmin allows any console role into the admin API surface.
// Individual handlers must call requirePerm for sensitive actions.
func (s *Server) requireAdmin(w http.ResponseWriter, r *http.Request) *auth.Claims {
	c := claimsFrom(r)
	if !isAdminRole(c.Role) {
		writeErr(w, 403, "forbidden")
		return nil
	}
	return c
}

func (s *Server) requirePerm(w http.ResponseWriter, r *http.Request, perm string) *auth.Claims {
	c := claimsFrom(r)
	if !roleHasPerm(c.Role, perm) {
		writeErrCode(w, 403, "forbidden", "insufficient role for this action")
		return nil
	}
	return c
}
