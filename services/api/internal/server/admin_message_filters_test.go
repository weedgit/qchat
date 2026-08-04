package server

import "testing"

func TestAppendAdminMessageFilters(t *testing.T) {
	q, args := appendAdminMessageFilters("SELECT 1 WHERE 1=1", []any{"ent"}, "file", "")
	if len(args) != 2 {
		t.Fatalf("args=%v", args)
	}
	if args[1] != "file" {
		t.Fatalf("type arg=%v", args[1])
	}
	if q != `SELECT 1 WHERE 1=1 AND LOWER(m.type) = LOWER($2)` {
		t.Fatalf("q=%q", q)
	}
}

func TestNormalizeAdminMessageType(t *testing.T) {
	for _, tc := range []struct {
		in   string
		want string
		ok   bool
	}{
		{"file", "file", true},
		{"File", "file", true},
		{"all", "", true},
		{"", "", true},
		{"bogus", "", false},
	} {
		got, ok := normalizeAdminMessageType(tc.in)
		if got != tc.want || ok != tc.ok {
			t.Fatalf("%q => (%q,%v) want (%q,%v)", tc.in, got, ok, tc.want, tc.ok)
		}
	}
}
