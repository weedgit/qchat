package server

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/qchat/qchat/services/api/internal/auth"
)

const mfaRecoveryCodeCount = 10

func isAdminRole(role string) bool {
	return role == "enterprise_admin" || role == "platform_owner"
}

func (s *Server) clearMFARecoveryCodes(ctx context.Context, userID string) {
	_, _ = s.db.Exec(ctx, `DELETE FROM mfa_recovery_codes WHERE user_id=$1`, userID)
}

// issueMFARecoveryCodes replaces unused codes and returns plaintext codes once.
func (s *Server) issueMFARecoveryCodes(ctx context.Context, userID string) ([]string, error) {
	codes, err := auth.NewRecoveryCodes(mfaRecoveryCodeCount)
	if err != nil {
		return nil, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM mfa_recovery_codes WHERE user_id=$1`, userID); err != nil {
		return nil, err
	}
	for _, raw := range codes {
		norm := auth.NormalizeRecoveryCode(raw)
		hash := auth.HashRefresh(norm)
		if _, err := tx.Exec(ctx, `
			INSERT INTO mfa_recovery_codes (id, user_id, code_hash)
			VALUES ($1,$2,$3)`, uuid.New(), userID, hash); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return codes, nil
}

func (s *Server) recoveryCodesRemaining(ctx context.Context, userID string) int {
	var n int
	_ = s.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM mfa_recovery_codes
		WHERE user_id=$1 AND used_at IS NULL`, userID).Scan(&n)
	return n
}

// consumeMFARecoveryCode marks a matching unused code as used. Returns true on success.
func (s *Server) consumeMFARecoveryCode(ctx context.Context, userID, code string) bool {
	norm := auth.NormalizeRecoveryCode(code)
	if len(norm) < 8 {
		return false
	}
	hash := auth.HashRefresh(norm)
	tag, err := s.db.Exec(ctx, `
		UPDATE mfa_recovery_codes
		SET used_at=now()
		WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL`, userID, hash)
	return err == nil && tag.RowsAffected() > 0
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
		"mfa_active":               active,
		"configured":               active || secret != "",
		"recovery_codes_remaining": s.recoveryCodesRemaining(r.Context(), c.UserID),
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

// handleMFAActivate confirms enrollment with a valid TOTP code and issues recovery codes.
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
	codes, err := s.issueMFARecoveryCodes(r.Context(), c.UserID)
	if err != nil {
		writeErrCode(w, 500, "recovery_failed", "MFA enabled but recovery codes failed")
		return
	}
	s.audit(r.Context(), c.UserID, c.EnterpriseID, "user.mfa_enable", "user", c.UserID, "", clientIP(r), nil)
	writeJSON(w, 200, map[string]any{
		"ok": true, "mfa_active": true, "recovery_codes": codes,
	})
}

// handleMFADisable turns MFA off after verifying a current TOTP or recovery code.
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
	code := strings.TrimSpace(req.Code)
	ok := auth.VerifyTOTP(secret, code, time.Now())
	if !ok {
		ok = s.consumeMFARecoveryCode(r.Context(), c.UserID, code)
	}
	if !ok {
		writeErrCode(w, 401, "mfa_invalid", "invalid MFA code")
		return
	}
	_, err = s.db.Exec(r.Context(), `
		UPDATE users SET mfa_active=FALSE, mfa_secret='' WHERE id=$1`, c.UserID)
	if err != nil {
		writeErrCode(w, 500, "disable_failed", "could not disable MFA")
		return
	}
	s.clearMFARecoveryCodes(r.Context(), c.UserID)
	s.audit(r.Context(), c.UserID, c.EnterpriseID, "user.mfa_disable", "user", c.UserID, "", clientIP(r), nil)
	writeJSON(w, 200, map[string]any{"ok": true, "mfa_active": false})
}

// handleMFARecoveryRegenerate replaces recovery codes after verifying a TOTP code.
func (s *Server) handleMFARecoveryRegenerate(w http.ResponseWriter, r *http.Request) {
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
	codes, err := s.issueMFARecoveryCodes(r.Context(), c.UserID)
	if err != nil {
		writeErrCode(w, 500, "recovery_failed", "could not regenerate recovery codes")
		return
	}
	s.audit(r.Context(), c.UserID, c.EnterpriseID, "user.mfa_recovery_regenerate", "user", c.UserID, "", clientIP(r), nil)
	writeJSON(w, 200, map[string]any{"recovery_codes": codes})
}

func (s *Server) verifyLoginMFA(w http.ResponseWriter, r *http.Request, uid, role, secret string, active bool, code string) bool {
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
	if secret != "" && auth.VerifyTOTP(secret, code, time.Now()) {
		return true
	}
	if s.consumeMFARecoveryCode(r.Context(), uid, code) {
		s.audit(r.Context(), uid, "", "user.mfa_recovery_used", "user", uid, "", clientIP(r), nil)
		return true
	}
	writeErrCode(w, 401, "mfa_invalid", "invalid MFA or recovery code")
	return false
}
