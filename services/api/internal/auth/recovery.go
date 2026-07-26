package auth

import (
	"crypto/rand"
	"fmt"
	"strings"
)

const recoveryAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no I/O/0/1

// NewRecoveryCodes returns n human-friendly single-use codes (XXXX-XXXX).
func NewRecoveryCodes(n int) ([]string, error) {
	if n <= 0 {
		return nil, fmt.Errorf("n must be positive")
	}
	out := make([]string, 0, n)
	buf := make([]byte, 8)
	for len(out) < n {
		if _, err := rand.Read(buf); err != nil {
			return nil, err
		}
		var b strings.Builder
		for i := 0; i < 8; i++ {
			if i == 4 {
				b.WriteByte('-')
			}
			b.WriteByte(recoveryAlphabet[int(buf[i])%len(recoveryAlphabet)])
		}
		out = append(out, b.String())
	}
	return out, nil
}

// NormalizeRecoveryCode uppercases and strips spaces/dashes for hashing lookup.
func NormalizeRecoveryCode(code string) string {
	code = strings.ToUpper(strings.TrimSpace(code))
	code = strings.ReplaceAll(code, " ", "")
	code = strings.ReplaceAll(code, "-", "")
	return code
}
