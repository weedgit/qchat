package auth

import (
	"encoding/base32"
	"strings"
	"testing"
	"time"
)

// RFC 6238 Appendix B SHA-1 vectors, truncated to 6 digits.
func TestVerifyTOTPKnownVector(t *testing.T) {
	secret := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(
		[]byte("12345678901234567890"),
	)
	cases := []struct {
		unix int64
		code string
	}{
		{59, "287082"},
		{1111111109, "081804"},
		{1111111111, "050471"},
		{1234567890, "005924"},
		{2000000000, "279037"},
	}
	for _, tc := range cases {
		if !VerifyTOTP(secret, tc.code, time.Unix(tc.unix, 0)) {
			t.Fatalf("expected valid TOTP at %d for %s", tc.unix, tc.code)
		}
	}
	if VerifyTOTP(secret, "000000", time.Unix(59, 0)) {
		t.Fatal("expected invalid code to fail")
	}
}

func TestNewTOTPSecretAndURI(t *testing.T) {
	secret, err := NewTOTPSecret()
	if err != nil {
		t.Fatal(err)
	}
	if len(secret) < 16 {
		t.Fatalf("secret too short: %s", secret)
	}
	uri := TOTPURI("Rchat", "admin@example.com", secret)
	if !strings.HasPrefix(uri, "otpauth://totp/") || !strings.Contains(uri, "secret="+secret) {
		t.Fatalf("unexpected uri: %s", uri)
	}
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(secret)
	if err != nil {
		t.Fatal(err)
	}
	code := hotp(key, uint64(time.Now().Unix()/totpPeriod))
	if !VerifyTOTP(secret, code, time.Now()) {
		t.Fatalf("self-generated code failed: %s", code)
	}
}
