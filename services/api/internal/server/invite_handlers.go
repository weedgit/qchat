package server

import (
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/qchat/qchat/services/api/internal/auth"
)

func (s *Server) resolveEnterpriseInviteTarget(w http.ResponseWriter, r *http.Request, c *auth.Claims) (string, bool) {
	entID := strings.TrimSpace(r.PathValue("id"))
	if entID == "" {
		entID = c.EnterpriseID
	}
	if entID == "" {
		writeErrCode(w, 400, "no_enterprise", "enterprise required")
		return "", false
	}
	if !isPlatformAdminRole(c.Role) && entID != c.EnterpriseID {
		writeErrCode(w, 403, "forbidden", "insufficient role for this action")
		return "", false
	}
	var exists bool
	if err := s.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM enterprises WHERE id=$1)`, entID).Scan(&exists); err != nil || !exists {
		writeErrCode(w, 404, "not_found", "enterprise not found")
		return "", false
	}
	return entID, true
}

func (s *Server) adminRotateInvite(w http.ResponseWriter, r *http.Request, entID string, c *auth.Claims) {
	code := strings.ToUpper(uuid.NewString()[:8])
	_, err := s.db.Exec(r.Context(), `UPDATE enterprises SET invite_code=$2, invite_active=TRUE WHERE id=$1`, entID, code)
	if err != nil {
		writeErr(w, 500, "rotate failed")
		return
	}
	s.audit(r.Context(), c.UserID, entID, "invite.rotate", "enterprise", entID, "", clientIP(r), map[string]any{"invite_code": code})
	writeJSON(w, 200, map[string]any{"invite_code": code, "invite_active": true})
}

func (s *Server) adminRevokeInvite(w http.ResponseWriter, r *http.Request, entID string, c *auth.Claims) {
	_, err := s.db.Exec(r.Context(), `UPDATE enterprises SET invite_active=FALSE WHERE id=$1`, entID)
	if err != nil {
		writeErr(w, 500, "revoke failed")
		return
	}
	s.audit(r.Context(), c.UserID, entID, "invite.revoke", "enterprise", entID, "", clientIP(r), nil)
	writeJSON(w, 200, map[string]any{"invite_active": false})
}

func (s *Server) adminActivateInvite(w http.ResponseWriter, r *http.Request, entID string, c *auth.Claims) {
	_, err := s.db.Exec(r.Context(), `UPDATE enterprises SET invite_active=TRUE WHERE id=$1`, entID)
	if err != nil {
		writeErr(w, 500, "activate failed")
		return
	}
	s.audit(r.Context(), c.UserID, entID, "invite.activate", "enterprise", entID, "", clientIP(r), nil)
	writeJSON(w, 200, map[string]any{"invite_active": true})
}

func (s *Server) handleAdminRotateInvite(w http.ResponseWriter, r *http.Request) {
	c := s.requirePerm(w, r, permInviteManage)
	if c == nil {
		return
	}
	s.adminRotateInvite(w, r, c.EnterpriseID, c)
}

func (s *Server) handleAdminRevokeInvite(w http.ResponseWriter, r *http.Request) {
	c := s.requirePerm(w, r, permInviteManage)
	if c == nil {
		return
	}
	s.adminRevokeInvite(w, r, c.EnterpriseID, c)
}

func (s *Server) handleAdminActivateInvite(w http.ResponseWriter, r *http.Request) {
	c := s.requirePerm(w, r, permInviteManage)
	if c == nil {
		return
	}
	s.adminActivateInvite(w, r, c.EnterpriseID, c)
}

func (s *Server) handleAdminEnterpriseRotateInvite(w http.ResponseWriter, r *http.Request) {
	c := s.requirePerm(w, r, permInviteManage)
	if c == nil {
		return
	}
	entID, ok := s.resolveEnterpriseInviteTarget(w, r, c)
	if !ok {
		return
	}
	s.adminRotateInvite(w, r, entID, c)
}

func (s *Server) handleAdminEnterpriseRevokeInvite(w http.ResponseWriter, r *http.Request) {
	c := s.requirePerm(w, r, permInviteManage)
	if c == nil {
		return
	}
	entID, ok := s.resolveEnterpriseInviteTarget(w, r, c)
	if !ok {
		return
	}
	s.adminRevokeInvite(w, r, entID, c)
}

func (s *Server) handleAdminEnterpriseActivateInvite(w http.ResponseWriter, r *http.Request) {
	c := s.requirePerm(w, r, permInviteManage)
	if c == nil {
		return
	}
	entID, ok := s.resolveEnterpriseInviteTarget(w, r, c)
	if !ok {
		return
	}
	s.adminActivateInvite(w, r, entID, c)
}
