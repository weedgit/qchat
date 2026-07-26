package auth

import (
	"strings"
	"testing"
)

func TestNewNumericCodeShape(t *testing.T) {
	code, err := NewNumericCode(6)
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(code) != 6 {
		t.Fatalf("len(%q) = %d, want 6", code, len(code))
	}
	if strings.Trim(code, "0123456789") != "" {
		t.Fatalf("code %q contains non-digits", code)
	}
}

func TestNewNumericCodeRejectsNonPositiveLength(t *testing.T) {
	if _, err := NewNumericCode(0); err == nil {
		t.Fatal("expected error for zero digits")
	}
}

// A fixed or weakly seeded code would collapse to a handful of values; 200
// draws from a 10^6 space should stay overwhelmingly distinct.
func TestNewNumericCodeIsNotConstant(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 200; i++ {
		code, err := NewNumericCode(6)
		if err != nil {
			t.Fatalf("unexpected: %v", err)
		}
		seen[code] = true
	}
	if len(seen) < 190 {
		t.Fatalf("only %d distinct codes in 200 draws", len(seen))
	}
}

func TestNewNumericCodeUsesEveryDigit(t *testing.T) {
	var b strings.Builder
	for i := 0; i < 400; i++ {
		code, err := NewNumericCode(6)
		if err != nil {
			t.Fatalf("unexpected: %v", err)
		}
		b.WriteString(code)
	}
	all := b.String()
	for _, d := range "0123456789" {
		if !strings.ContainsRune(all, d) {
			t.Fatalf("digit %q never produced", d)
		}
	}
}
