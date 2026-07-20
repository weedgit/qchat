package livekit

import (
	"strings"
	"testing"
	"time"
)

func TestMintJoinToken(t *testing.T) {
	cfg := TokenConfig{
		URL:       "ws://localhost:7880",
		APIKey:    "devkey",
		APISecret: "secret-that-is-at-least-32-characters-long",
	}
	tok, err := MintJoinToken(cfg, "room-1", "user-1", "Alice", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(tok, ".")
	if len(parts) != 3 {
		t.Fatalf("expected JWT, got %q", tok)
	}
}
