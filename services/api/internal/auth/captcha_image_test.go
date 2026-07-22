package auth

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestRenderCaptchaPNG(t *testing.T) {
	code := NewCaptchaCode()
	url, err := RenderCaptchaPNG(code)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(url, "data:image/png;base64,") {
		t.Fatalf("unexpected prefix: %s", url[:min(40, len(url))])
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(url, "data:image/png;base64,"))
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) < 100 || raw[0] != 0x89 || raw[1] != 'P' {
		t.Fatalf("not a PNG payload, len=%d", len(raw))
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
