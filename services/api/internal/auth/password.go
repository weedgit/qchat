package auth

import (
	"errors"
	"regexp"
	"unicode"

	"golang.org/x/crypto/bcrypt"
)

var (
	ErrWeakPassword = errors.New("password must be at least 8 characters and contain only letters and digits")
	phoneRe         = regexp.MustCompile(`^\d{11}$`)
	usernameRe      = regexp.MustCompile(`^[\p{L}\p{N}_\p{So}]{2,32}$`)
)

func ValidatePhone(phone string) bool { return phoneRe.MatchString(phone) }

func ValidateUsername(name string) bool { return usernameRe.MatchString(name) }

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
