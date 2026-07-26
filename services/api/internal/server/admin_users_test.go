package server

import (
	"net/http/httptest"
	"testing"
)

func TestEscapeLike(t *testing.T) {
	cases := []struct{ in, want string }{
		{"alice", "alice"},
		{"100%", `100\%`},
		{"a_b", `a\_b`},
		{`back\slash`, `back\\slash`},
		{"%_%", `\%\_\%`},
	}
	for _, tc := range cases {
		if got := escapeLike(tc.in); got != tc.want {
			t.Fatalf("escapeLike(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestAdminListRange(t *testing.T) {
	cases := []struct {
		query      string
		wantLimit  int
		wantOffset int
	}{
		{"", adminUsersDefaultLimit, 0},
		{"?limit=10&offset=20", 10, 20},
		{"?limit=9999", adminUsersMaxLimit, 0},
		{"?limit=0", adminUsersDefaultLimit, 0},
		{"?limit=-5&offset=-5", adminUsersDefaultLimit, 0},
		{"?limit=abc&offset=xyz", adminUsersDefaultLimit, 0},
	}
	for _, tc := range cases {
		r := httptest.NewRequest("GET", "/v1/admin/users"+tc.query, nil)
		limit, offset := adminListRange(r)
		if limit != tc.wantLimit || offset != tc.wantOffset {
			t.Fatalf("adminListRange(%q) = (%d, %d), want (%d, %d)",
				tc.query, limit, offset, tc.wantLimit, tc.wantOffset)
		}
	}
}

func TestAdminReason(t *testing.T) {
	if _, ok := adminReason(httptest.NewRecorder(), "  short  "); ok {
		t.Fatal("short reason accepted")
	}
	if _, ok := adminReason(httptest.NewRecorder(), ""); ok {
		t.Fatal("empty reason accepted")
	}
	got, ok := adminReason(httptest.NewRecorder(), "  ticket #1234 abuse report  ")
	if !ok {
		t.Fatal("valid reason rejected")
	}
	if got != "ticket #1234 abuse report" {
		t.Fatalf("reason not trimmed: %q", got)
	}
}
