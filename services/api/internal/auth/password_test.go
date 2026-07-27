package auth

import "testing"

func TestValidatePassword(t *testing.T) {
	if err := ValidatePassword("12345678"); err != nil {
		t.Fatal(err)
	}
	if err := ValidatePassword("abc12345"); err != nil {
		t.Fatal(err)
	}
	if err := ValidatePassword("short"); err == nil {
		t.Fatal("expected weak")
	}
	if err := ValidatePassword("bad!chars"); err == nil {
		t.Fatal("expected weak")
	}
}

func TestPhoneAndHash(t *testing.T) {
	if !ValidatePhone("13800138000") {
		t.Fatal("phone")
	}
	h, err := HashPassword("abc12345")
	if err != nil {
		t.Fatal(err)
	}
	if !CheckPassword(h, "abc12345") {
		t.Fatal("check")
	}
}

func TestValidateDisplayName(t *testing.T) {
	ok := []string{"Alice", "李明", "cool_user", "hi 👋", "A B"}
	for _, name := range ok {
		if err := ValidateDisplayName(name); err != nil {
			t.Fatalf("%q: %v", name, err)
		}
	}
	bad := []string{"", "x", "bad!", "at@name", "hash#tag", "a\tb"}
	for _, name := range bad {
		if err := ValidateDisplayName(name); err == nil {
			t.Fatalf("%q: expected invalid", name)
		}
	}
}
