package server

import (
	"net/http"
	"strings"

	"github.com/google/uuid"
)

func (s *Server) handleAdminRotateInvite(w http.ResponseWriter, r *http.Request) {
	c := s.requirePerm(w, r, permInviteManage)
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
	c := s.requirePerm(w, r, permInviteManage)
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
	c := s.requirePerm(w, r, permInviteManage)
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
