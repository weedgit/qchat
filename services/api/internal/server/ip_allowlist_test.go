package server

import "testing"

func TestNormalizeCIDR(t *testing.T) {
	cases := []struct {
		in, want string
		ok       bool
	}{
		{"10.0.0.1", "10.0.0.1/32", true},
		{"10.0.0.5/24", "10.0.0.0/24", true},
		{" 192.168.1.10/32 ", "192.168.1.10/32", true},
		{"not-an-ip", "", false},
		{"", "", false},
		{"10.0.0.1/33", "", false},
	}
	for _, tc := range cases {
		got, err := normalizeCIDR(tc.in)
		if tc.ok {
			if err != nil || got != tc.want {
				t.Fatalf("normalizeCIDR(%q)=%q,%v want %q", tc.in, got, err, tc.want)
			}
		} else if err == nil {
			t.Fatalf("normalizeCIDR(%q) should fail, got %q", tc.in, got)
		}
	}
}

func TestIPAllowedByList(t *testing.T) {
	if !ipAllowedByList("1.2.3.4", nil) {
		t.Fatal("empty list should allow")
	}
	cidrs := []string{"10.0.0.0/8", "192.168.1.1/32"}
	if !ipAllowedByList("10.1.2.3", cidrs) {
		t.Fatal("expected 10.1.2.3 allowed")
	}
	if !ipAllowedByList("192.168.1.1", cidrs) {
		t.Fatal("expected exact IP allowed")
	}
	if ipAllowedByList("8.8.8.8", cidrs) {
		t.Fatal("expected 8.8.8.8 denied")
	}
}
