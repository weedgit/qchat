package server

import "testing"

func TestCanManagePins(t *testing.T) {
	cases := []struct {
		name     string
		convType string
		role     string
		want     bool
	}{
		{"group owner pins", "social_group", "owner", true},
		{"group admin pins", "social_group", "admin", true},
		{"group member cannot pin", "social_group", "member", false},
		{"group pending cannot pin", "social_group", "pending", false},
		{"non member cannot pin", "social_group", "", false},
		{"dm participant pins", "dm", "member", true},
		{"dm owner pins", "dm", "owner", true},
		{"dm non member cannot pin", "dm", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := canManagePins(tc.convType, tc.role); got != tc.want {
				t.Fatalf("canManagePins(%q, %q) = %v, want %v", tc.convType, tc.role, got, tc.want)
			}
		})
	}
}
