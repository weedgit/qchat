package server

import (
	"net/http"

	"github.com/qchat/qchat/services/api/internal/auth"
)

// Console roles: platform_admin (whole platform), enterprise_admin (one company), member (chat user).
const (
	rolePlatformAdmin   = "platform_admin"
	roleEnterpriseAdmin = "enterprise_admin"
	roleMember          = "member"
)

// Permission keys enforced by requirePerm.
const (
	permAdminRead            = "admin.read"
	permMessagesInspect      = "admin.messages.inspect"
	permUsersCreateMember    = "admin.users.create_member"
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
	rolePlatformAdmin: {
		permAdminRead: true, permMessagesInspect: true,
		permUsersCreateMember: true,
		permUsersResetPassword: true, permUsersRevokeSession: true, permUsersBan: true,
		permInviteManage: true, permEnterpriseWrite: true, permSecurityWrite: true,
		permRetention: true, permIssueEnterpriseAdmin: true,
	},
	roleEnterpriseAdmin: {
		permAdminRead: true, permMessagesInspect: true,
		permUsersCreateMember: true,
		permUsersResetPassword: true, permUsersRevokeSession: true, permUsersBan: true,
		permInviteManage: true, permEnterpriseWrite: true, permSecurityWrite: true,
		permRetention: true,
	},
}

// normalizeRole maps legacy JWT/DB values to the current role model.
func normalizeRole(role string) string {
	switch role {
	case "platform_owner":
		return rolePlatformAdmin
	case "compliance", "support", "read_only":
		return roleMember
	default:
		return role
	}
}

func isPlatformAdminRole(role string) bool {
	return normalizeRole(role) == rolePlatformAdmin
}

// isAdminRole reports whether the account may use the admin console.
func isAdminRole(role string) bool {
	r := normalizeRole(role)
	_, ok := rolePerms[r]
	return ok
}

func roleHasPerm(role, perm string) bool {
	return rolePerms[normalizeRole(role)][perm]
}

// requireAdmin allows platform_admin or enterprise_admin into the admin API surface.
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
