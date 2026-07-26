package server

import (
	"net/http"
	"strings"
	"time"

	"github.com/qchat/qchat/services/api/internal/auth"
)

func isAdminRole(role string) bool {
	return role == "enterprise_admin" || role == "platform_owner"
}

// handleMFAStatus returns whether MFA is active for the current admin.
func (s *Server) handleMFAStatus(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	if !isAdminRole(c.Role) {
		writeErrCode(w, 403, "forbidden", "MFA is only available for administrators")
		return
	}
	var active bool
	var secret string
	err := s.db.QueryRow(r.Context(), `
		SELECT mfa_active, COALESCE(mfa_secret,'') FROM users WHERE id=$1`, c.UserID).
		Scan(&active, &secret)
	if err != nil {
		writeErrCode(w, 404, "not_found", "user not found")
		return
	}
	writeJSON(w, 200, map[string]any{
		"mfa_active": active,
		"configured": active || secret != "",
	})
}

// handleMFASetup starts enrollment: stores a pending secret and returns otpauth URI.
func (s *Server) handleMFASetup(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	if !isAdminRole(c.Role) {
		writeErrCode(w, 403, "forbidden", "MFA is only available for administrators")
		return
	}
	var active bool
	err := s.db.QueryRow(r.Context(), `SELECT mfa_active FROM users WHERE id=$1`, c.UserID).Scan(&active)
	if err != nil {
		writeErrCode(w, 404, "not_found", "user not found")
		return
	}
	if active {
		writeErrCode(w, 409, "mfa_already_active", "MFA is already enabled")
		return
	}
	secret, err := auth.NewTOTPSecret()
	if err != nil {
		writeErrCode(w, 500, "setup_failed", "could not generate MFA secret")
		return
	}
	_, err = s.db.Exec(r.Context(), `
		UPDATE users SET mfa_secret=$2, mfa_active=FALSE WHERE id=$1`, c.UserID, secret)
	if err != nil {
		writeErrCode(w, 500, "setup_failed", "could not store MFA secret")
		return
	}
	account := c.UserID
	var phone, username string
	_ = s.db.QueryRow(r.Context(), `SELECT phone, username FROM users WHERE id=$1`, c.UserID).
		Scan(&phone, &username)
	if username != "" {
		account = username
	} else if phone != "" {
		account = phone
	}
	uri := auth.TOTPURI("Qchat", account, secret)
	s.audit(r.Context(), c.UserID, c.EnterpriseID, "user.mfa_setup", "user", c.UserID, "", clientIP(r), nil)
	writeJSON(w, 200, map[string]any{
		"secret":      secret,
		"otpauth_uri": uri,
		"mfa_active":  false,
	})
}

// handleMFAActivate confirms enrollment with a valid TOTP code.
func (s *Server) handleMFAActivate(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	if !isAdminRole(c.Role) {
		writeErrCode(w, 403, "forbidden", "MFA is only available for administrators")
		return
	}
	var req struct {
		Code string `json:"code"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErrCode(w, 400, "invalid_json", "invalid json")
		return
	}
	var secret string
	var active bool
	err := s.db.QueryRow(r.Context(), `
		SELECT COALESCE(mfa_secret,''), mfa_active FROM users WHERE id=$1`, c.UserID).
		Scan(&secret, &active)
	if err != nil {
		writeErrCode(w, 404, "not_found", "user not found")
		return
	}
	if active {
		writeErrCode(w, 409, "mfa_already_active", "MFA is already enabled")
		return
	}
	if secret == "" {
		writeErrCode(w, 400, "mfa_not_setup", "call MFA setup first")
		return
	}
	if !auth.VerifyTOTP(secret, req.Code, time.Now()) {
		writeErrCode(w, 401, "mfa_invalid", "invalid MFA code")
		return
	}
	_, err = s.db.Exec(r.Context(), `UPDATE users SET mfa_active=TRUE WHERE id=$1`, c.UserID)
	if err != nil {
		writeErrCode(w, 500, "activate_failed", "could not activate MFA")
		return
	}
	s.audit(r.Context(), c.UserID, c.EnterpriseID, "user.mfa_enable", "user", c.UserID, "", clientIP(r), nil)
	writeJSON(w, 200, map[string]any{"ok": true, "mfa_active": true})
}

// handleMFADisable turns MFA off after verifying a current code.
func (s *Server) handleMFADisable(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	if !isAdminRole(c.Role) {
		writeErrCode(w, 403, "forbidden", "MFA is only available for administrators")
		return
	}
	var req struct {
		Code string `json:"code"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErrCode(w, 400, "invalid_json", "invalid json")
		return
	}
	var secret string
	var active bool
	err := s.db.QueryRow(r.Context(), `
		SELECT COALESCE(mfa_secret,''), mfa_active FROM users WHERE id=$1`, c.UserID).
		Scan(&secret, &active)
	if err != nil {
		writeErrCode(w, 404, "not_found", "user not found")
		return
	}
	if !active {
		writeErrCode(w, 400, "mfa_not_active", "MFA is not enabled")
		return
	}
	if !auth.VerifyTOTP(secret, req.Code, time.Now()) {
		writeErrCode(w, 401, "mfa_invalid", "invalid MFA code")
		return
	}
	_, err = s.db.Exec(r.Context(), `
		UPDATE users SET mfa_active=FALSE, mfa_secret='' WHERE id=$1`, c.UserID)
	if err != nil {
		writeErrCode(w, 500, "disable_failed", "could not disable MFA")
		return
	}
	s.audit(r.Context(), c.UserID, c.EnterpriseID, "user.mfa_disable", "user", c.UserID, "", clientIP(r), nil)
	writeJSON(w, 200, map[string]any{"ok": true, "mfa_active": false})
}

func (s *Server) verifyLoginMFA(w http.ResponseWriter, role, secret string, active bool, code string) bool {
	if !active {
		return true
	}
	// Only enforce MFA for administrator accounts (requirements-en §3 security policies).
	if !isAdminRole(role) {
		return true
	}
	code = strings.TrimSpace(code)
	if code == "" {
		writeErrCode(w, 401, "mfa_required", "multi-factor authentication required")
		return false
	}
	if secret == "" || !auth.VerifyTOTP(secret, code, time.Now()) {
		writeErrCode(w, 401, "mfa_invalid", "invalid MFA code")
		return false
	}
	return true
}
