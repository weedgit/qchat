package server

import "testing"

func TestPhoneLookupQuery(t *testing.T) {
	cases := []struct {
		in      string
		want    string
		wantOK  bool
	}{
		{"13800138000", "13800138000", true},
		{"138 0013 8000", "13800138000", true},
		{"(138)-0013-8000", "13800138000", true},
		{"138", "138", true},
		{"alice", "", false},
		{"user138", "", false},
		{"", "", false},
		{"   ", "", false},
	}
	for _, tc := range cases {
		got, ok := phoneLookupQuery(tc.in)
		if ok != tc.wantOK || got != tc.want {
			t.Fatalf("phoneLookupQuery(%q) = (%q, %v), want (%q, %v)", tc.in, got, ok, tc.want, tc.wantOK)
		}
	}
}
