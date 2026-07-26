package server

import "testing"

func TestVoiceDurationOK(t *testing.T) {
	cases := []struct {
		sec  int
		want bool
	}{
		{0, false},
		{-1, false},
		{1, true},
		{30, true},
		{60, true},
		{61, false},
		{120, false},
	}
	for _, tc := range cases {
		if got := voiceDurationOK(tc.sec); got != tc.want {
			t.Fatalf("voiceDurationOK(%d) = %v, want %v", tc.sec, got, tc.want)
		}
	}
}
