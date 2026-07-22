package server

import (
	"net/http"
	"strings"

	"github.com/google/uuid"
)

// handleJoinEnterprise attaches the current user to a company via invite code
// (join team by invite; Qchat requirements: join company with invitation code).
func (s *Server) handleJoinEnterprise(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	var req struct {
		InviteCode string `json:"invite_code"`
		DeviceType string `json:"device_type"`
		DeviceName string `json:"device_name"`
		DeviceID   string `json:"device_id"`
		Platform   string `json:"platform"`
	}
	if err := decodeJSON(r, &req); err != nil || strings.TrimSpace(req.InviteCode) == "" {
		writeErr(w, 400, "invite_code required")
		return
	}
	code := strings.TrimSpace(req.InviteCode)
	var entID string
	var active bool
	var name string
	err := s.db.QueryRow(r.Context(), `
		SELECT id::text, invite_active, name FROM enterprises WHERE invite_code=$1`, code).
		Scan(&entID, &active, &name)
	if err != nil || !active {
		writeErr(w, 400, "invalid invite code")
		return
	}

	var current *string
	_ = s.db.QueryRow(r.Context(), `SELECT enterprise_id::text FROM users WHERE id=$1`, c.UserID).Scan(&current)
	already := current != nil && *current != ""
	same := already && *current == entID
	if same {
		_ = s.addUserToEnterpriseDefaultChat(r.Context(), entID, c.UserID)
		writeJSON(w, 200, map[string]any{
			"ok": true, "enterprise_id": entID, "name": name, "already_member": true,
		})
		return
	}

	_, err = s.db.Exec(r.Context(), `UPDATE users SET enterprise_id=$2 WHERE id=$1`, c.UserID, entID)
	if err != nil {
		writeErr(w, 500, "join failed")
		return
	}
	if err := s.addUserToEnterpriseDefaultChat(r.Context(), entID, c.UserID); err != nil {
		writeErr(w, 500, "join chat failed")
		return
	}
	action := "enterprise.join"
	if already {
		action = "enterprise.switch"
	}
	s.audit(r.Context(), c.UserID, entID, action, "enterprise", entID, "", clientIP(r), map[string]any{
		"invite_code": code,
	})

	dtype := normalizeDevice(req.DeviceType)
	if dtype == "" {
		dtype = "web"
	}
	deviceID := ensureDeviceID(req.DeviceID)
	s.revokeSameTypeSessions(r, c.UserID, dtype)
	tok, err := s.issueSession(r, c.UserID, entID, c.Role, dtype, req.DeviceName, deviceID, req.Platform)
	if err != nil {
		writeErr(w, 500, "session failed")
		return
	}
	tok["enterprise_id"] = entID
	tok["name"] = name
	writeJSON(w, 200, tok)
}

func (s *Server) handleAdminRotateInvite(w http.ResponseWriter, r *http.Request) {
	c := s.requireAdmin(w, r)
	if c == nil {
		return
	}
	code := strings.ToUpper(uuid.NewString()[:8])
	_, err := s.db.Exec(r.Context(), `UPDATE enterprises SET invite_code=$2, invite_active=TRUE WHERE id=$1`, c.EnterpriseID, code)
	if err != nil {
		writeErr(w, 500, "rotate failed")
		return
	}
	s.audit(r.Context(), c.UserID, c.EnterpriseID, "invite.rotate", "enterprise", c.EnterpriseID, "", clientIP(r), map[string]any{"invite_code": code})
	writeJSON(w, 200, map[string]any{"invite_code": code, "invite_active": true})
}

func (s *Server) handleAdminRevokeInvite(w http.ResponseWriter, r *http.Request) {
	c := s.requireAdmin(w, r)
	if c == nil {
		return
	}
	_, err := s.db.Exec(r.Context(), `UPDATE enterprises SET invite_active=FALSE WHERE id=$1`, c.EnterpriseID)
	if err != nil {
		writeErr(w, 500, "revoke failed")
		return
	}
	s.audit(r.Context(), c.UserID, c.EnterpriseID, "invite.revoke", "enterprise", c.EnterpriseID, "", clientIP(r), nil)
	writeJSON(w, 200, map[string]any{"invite_active": false})
}

func (s *Server) handleAdminActivateInvite(w http.ResponseWriter, r *http.Request) {
	c := s.requireAdmin(w, r)
	if c == nil {
		return
	}
	_, err := s.db.Exec(r.Context(), `UPDATE enterprises SET invite_active=TRUE WHERE id=$1`, c.EnterpriseID)
	if err != nil {
		writeErr(w, 500, "activate failed")
		return
	}
	s.audit(r.Context(), c.UserID, c.EnterpriseID, "invite.activate", "enterprise", c.EnterpriseID, "", clientIP(r), nil)
	writeJSON(w, 200, map[string]any{"invite_active": true})
}
