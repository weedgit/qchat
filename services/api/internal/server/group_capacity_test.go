package server

import "testing"

func TestMaxSocialGroupMembersExceedsRequirementFloor(t *testing.T) {
	// Requirements: groups must support more than 1,000 members.
	if maxSocialGroupMembers <= 1000 {
		t.Fatalf("maxSocialGroupMembers=%d; want >1000", maxSocialGroupMembers)
	}
}

func TestGroupCapacityWouldExceed(t *testing.T) {
	cases := []struct {
		current, adding, max int
		want                 bool
	}{
		{0, 1, 5000, false},
		{4999, 1, 5000, false},
		{5000, 1, 5000, true},
		{4990, 20, 5000, true},
		{1000, 1, 5000, false},
	}
	for _, tc := range cases {
		got := tc.current+tc.adding > tc.max
		if got != tc.want {
			t.Fatalf("current=%d adding=%d max=%d got=%v want=%v",
				tc.current, tc.adding, tc.max, got, tc.want)
		}
	}
}
