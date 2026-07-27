package auth

import (
	"errors"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"
)

var (
	ErrWeakPassword       = errors.New("password must be at least 8 characters and contain only letters and digits")
	ErrInvalidDisplayName = errors.New("display name must be 2–64 letters, digits, spaces, underscores, or emoji (no special symbols)")
	phoneRe               = regexp.MustCompile(`^\d{11}$`)
	usernameRe            = regexp.MustCompile(`^[\p{L}\p{N}_\p{So}]{2,32}$`)
)

func ValidatePhone(phone string) bool { return phoneRe.MatchString(phone) }

func ValidateUsername(name string) bool { return usernameRe.MatchString(name) }

// ValidateDisplayName enforces requirements §2.2: unique visible names may include
// emoji but not special symbols. Spaces are allowed (unlike usernames).
func ValidateDisplayName(name string) error {
	name = strings.TrimSpace(name)
	n := utf8.RuneCountInString(name)
	if n < 2 || n > 64 {
		return ErrInvalidDisplayName
	}
	for _, r := range name {
		switch {
		case unicode.IsLetter(r), unicode.IsDigit(r), r == '_', r == ' ':
			continue
		case unicode.Is(unicode.So, r), unicode.Is(unicode.Sk, r):
			continue
		// ZWJ / variation selector / combining marks used in emoji sequences.
		case r == '\u200d', r == '\ufe0f', unicode.Is(unicode.Mn, r):
			continue
		default:
			return ErrInvalidDisplayName
		}
	}
	return nil
}

func ValidatePassword(pw string) error {
	if len(pw) < 8 {
		return ErrWeakPassword
	}
	for _, r := range pw {
		if !(unicode.IsLetter(r) || unicode.IsDigit(r)) {
			return ErrWeakPassword
		}
	}
	return nil
}

func HashPassword(pw string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	return string(b), err
}

func CheckPassword(hash, pw string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(pw)) == nil
}
