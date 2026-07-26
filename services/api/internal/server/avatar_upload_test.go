package server

import "testing"

func TestAllowedAvatarContentType(t *testing.T) {
	cases := []struct {
		ct   string
		want bool
	}{
		{"image/jpeg", true},
		{"image/png", true},
		{"image/gif", true},
		{"image/webp", true},
		{"IMAGE/JPEG", true},
		{" image/png ", true},
		{"image/svg+xml", false},
		{"image/svg", false},
		{"text/html", false},
		{"application/octet-stream", false},
		{"", false},
	}
	for _, tc := range cases {
		if got := allowedAvatarContentType(tc.ct); got != tc.want {
			t.Fatalf("allowedAvatarContentType(%q) = %v, want %v", tc.ct, got, tc.want)
		}
	}
}
