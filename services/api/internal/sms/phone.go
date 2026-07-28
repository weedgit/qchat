package sms

import (
	"regexp"
	"strings"
)

var nonDigit = regexp.MustCompile(`\D+`)

// DigitsOnly strips formatting characters from a phone string.
func DigitsOnly(phone string) string {
	return nonDigit.ReplaceAllString(phone, "")
}

func isCNMobileBody(d string) bool {
	return len(d) == 11 && d[0] == '1' && d[1] >= '3' && d[1] <= '9'
}

// NormalizeCNMobile returns an 11-digit CN mobile if phone looks like one
// (optional +86 / 0086 / 86 prefix), otherwise "".
// Numbers with an explicit non-+86 country code (e.g. +1…) never match.
func NormalizeCNMobile(phone string) string {
	trimmed := strings.TrimSpace(phone)
	d := DigitsOnly(trimmed)

	if strings.HasPrefix(trimmed, "+") {
		if strings.HasPrefix(d, "86") && len(d) == 13 && isCNMobileBody(d[2:]) {
			return d[2:]
		}
		return ""
	}

	switch {
	case isCNMobileBody(d):
		return d
	case len(d) == 13 && strings.HasPrefix(d, "86") && isCNMobileBody(d[2:]):
		return d[2:]
	case len(d) == 14 && strings.HasPrefix(d, "086") && isCNMobileBody(d[3:]):
		return d[3:]
	case len(d) == 15 && strings.HasPrefix(d, "0086") && isCNMobileBody(d[4:]):
		return d[4:]
	default:
		return ""
	}
}

// IsChinaMobile reports whether the number should be routed to Aliyun.
func IsChinaMobile(phone string) bool {
	return NormalizeCNMobile(phone) != ""
}

// ToE164 builds an E.164 number for Twilio. CN mobiles become +86XXXXXXXXXXX.
// Other digit strings are prefixed with + when no + was present.
func ToE164(phone string) string {
	trimmed := strings.TrimSpace(phone)
	if cn := NormalizeCNMobile(trimmed); cn != "" {
		return "+86" + cn
	}
	if strings.HasPrefix(trimmed, "+") {
		return "+" + DigitsOnly(trimmed)
	}
	d := DigitsOnly(trimmed)
	if d == "" {
		return trimmed
	}
	return "+" + d
}
