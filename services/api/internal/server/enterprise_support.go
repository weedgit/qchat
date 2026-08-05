package server

import (
	"fmt"
	"strings"
)

const maxEnterpriseSupportEmailLen = 120
const maxEnterpriseSupportPhoneLen = 32

func normalizeEnterpriseSupportEmail(raw string) (string, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", nil
	}
	if len(s) > maxEnterpriseSupportEmailLen {
		return "", fmt.Errorf("support_email too long")
	}
	if !strings.Contains(s, "@") || strings.HasPrefix(s, "@") || strings.HasSuffix(s, "@") {
		return "", fmt.Errorf("invalid support_email")
	}
	return s, nil
}

func normalizeEnterpriseSupportPhone(raw string) (string, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", nil
	}
	if len(s) > maxEnterpriseSupportPhoneLen {
		return "", fmt.Errorf("support_phone too long")
	}
	return s, nil
}
