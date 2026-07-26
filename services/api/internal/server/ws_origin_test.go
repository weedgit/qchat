package server

import "testing"

func TestWSOriginAllowed(t *testing.T) {
	cases := []struct {
		name    string
		cors    string
		origin  string
		allowed bool
	}{
		{"wildcard allows any browser origin", "*", "https://evil.example", true},
		{"wildcard allows empty origin", "*", "", true},
		{"empty config is permissive", "", "https://anything", true},
		{"empty origin allowed under an allowlist", "https://app.qchat.io", "", true},
		{"matching origin allowed", "https://app.qchat.io", "https://app.qchat.io", true},
		{"foreign origin rejected under allowlist", "https://app.qchat.io", "https://evil.example", false},
		{"localhost allowed under allowlist", "https://app.qchat.io", "http://localhost:3000", true},
		{"list membership allowed", "https://a.qchat.io,https://b.qchat.io", "https://b.qchat.io", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := wsOriginAllowed(tc.cors, tc.origin); got != tc.allowed {
				t.Fatalf("wsOriginAllowed(%q, %q) = %v, want %v", tc.cors, tc.origin, got, tc.allowed)
			}
		})
	}
}
