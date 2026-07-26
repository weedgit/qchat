package auth

import "testing"

func TestNewRecoveryCodes(t *testing.T) {
	codes, err := NewRecoveryCodes(10)
	if err != nil {
		t.Fatal(err)
	}
	if len(codes) != 10 {
		t.Fatalf("len=%d", len(codes))
	}
	seen := map[string]bool{}
	for _, c := range codes {
		if len(c) != 9 || c[4] != '-' {
			t.Fatalf("format: %q", c)
		}
		if seen[c] {
			t.Fatalf("duplicate %q", c)
		}
		seen[c] = true
		if NormalizeRecoveryCode(c) != NormalizeRecoveryCode(c[:4]+" "+c[5:]) {
			t.Fatalf("normalize mismatch for %q", c)
		}
	}
}

func TestNormalizeRecoveryCode(t *testing.T) {
	got := NormalizeRecoveryCode(" ab-cd-ef ")
	if got != "ABCDEF" {
		t.Fatalf("got %q", got)
	}
}
