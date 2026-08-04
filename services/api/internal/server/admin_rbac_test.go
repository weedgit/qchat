package server

import "testing"

func TestRolePermissionMatrix(t *testing.T) {
	cases := []struct {
		role string
		perm string
		ok   bool
	}{
		{roleEnterpriseAdmin, permMessagesInspect, true},
		{roleEnterpriseAdmin, permUsersBan, true},
		{roleEnterpriseAdmin, permIssueEnterpriseAdmin, false},
		{rolePlatformAdmin, permIssueEnterpriseAdmin, true},
		{roleMember, permAdminRead, false},
		{"platform_owner", permIssueEnterpriseAdmin, true},
		{"compliance", permAdminRead, false},
	}
	for _, tc := range cases {
		got := roleHasPerm(tc.role, tc.perm)
		if got != tc.ok {
			t.Fatalf("%s %s: got %v want %v", tc.role, tc.perm, got, tc.ok)
		}
	}
	if !isAdminRole(roleEnterpriseAdmin) || isAdminRole(roleMember) {
		t.Fatal("isAdminRole mismatch")
	}
	if !isPlatformAdminRole("platform_owner") {
		t.Fatal("legacy platform_owner should count as platform admin")
	}
}
