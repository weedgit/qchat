package server

import "testing"

func TestGuessRegionPrivateAndEmpty(t *testing.T) {
	if got := guessRegion(""); got != "unknown" {
		t.Fatalf("empty: %q", got)
	}
	for _, ip := range []string{"127.0.0.1", "10.0.0.1", "192.168.1.5", "::1"} {
		if got := guessRegion(ip); got != "local" {
			t.Fatalf("%s: got %q want local", ip, got)
		}
	}
}
