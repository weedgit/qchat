package server

import "testing"

func TestRolePermissionMatrix(t *testing.T) {
	cases := []struct {
		role string
		perm string
		ok   bool
	}{
		{roleCompliance, permMessagesInspect, true},
		{roleCompliance, permUsersBan, false},
		{roleSupport, permUsersResetPassword, true},
		{roleSupport, permMessagesInspect, false},
		{roleReadOnly, permAdminRead, true},
		{roleReadOnly, permUsersCreateMember, false},
		{roleEnterpriseAdmin, permUsersBan, true},
		{roleEnterpriseAdmin, permIssueEnterpriseAdmin, false},
		{rolePlatformOwner, permIssueEnterpriseAdmin, true},
		{roleMember, permAdminRead, false},
	}
	for _, tc := range cases {
		got := roleHasPerm(tc.role, tc.perm)
		if got != tc.ok {
			t.Fatalf("%s %s: got %v want %v", tc.role, tc.perm, got, tc.ok)
		}
	}
	if !isAdminRole(roleCompliance) || isAdminRole(roleMember) {
		t.Fatal("isAdminRole mismatch")
	}
}
