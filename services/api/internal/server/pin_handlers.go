package server

import (
	"net/http"

	"github.com/qchat/qchat/services/api/internal/ws"
)

// handlePinMessage mirrors Mattermost POST /posts/{post_id}/pin.
func (s *Server) handlePinMessage(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	msgID := r.PathValue("id")
	var convID, enterpriseID string
	err := s.db.QueryRow(r.Context(), `
		SELECT m.conversation_id::text, conv.enterprise_id::text
		FROM messages m JOIN conversations conv ON conv.id=m.conversation_id
		WHERE m.id=$1 AND m.recalled=FALSE`, msgID).Scan(&convID, &enterpriseID)
	if err != nil {
		writeErrCode(w, 404, "not_found", "not found")
		return
	}
	if enterpriseID != c.EnterpriseID {
		writeErrCode(w, 403, "forbidden", "forbidden")
		return
	}
	role := s.memberRole(r, convID, c.UserID)
	if role == "" || role == "pending" {
		writeErrCode(w, 403, "forbidden", "forbidden")
		return
	}
	_, err = s.db.Exec(r.Context(), `UPDATE conversations SET pinned_message_id=$2 WHERE id=$1`, convID, msgID)
	if err != nil {
		writeErrCode(w, 500, "update_failed", "update failed")
		return
	}
	s.hub.PublishToUsers(s.memberIDs(r, convID), ws.Event{
		Type: "message.pinned",
		Payload: map[string]any{"conversation_id": convID, "message_id": msgID},
	})
	writeJSON(w, 200, map[string]any{"ok": true, "conversation_id": convID, "message_id": msgID})
}

// handleUnpinMessage mirrors Mattermost POST /posts/{post_id}/unpin.
func (s *Server) handleUnpinMessage(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	msgID := r.PathValue("id")
	var convID, enterpriseID string
	var pinned *string
	err := s.db.QueryRow(r.Context(), `
		SELECT m.conversation_id::text, conv.enterprise_id::text, conv.pinned_message_id::text
		FROM messages m JOIN conversations conv ON conv.id=m.conversation_id
		WHERE m.id=$1`, msgID).Scan(&convID, &enterpriseID, &pinned)
	if err != nil {
		writeErrCode(w, 404, "not_found", "not found")
		return
	}
	if enterpriseID != c.EnterpriseID || s.memberRole(r, convID, c.UserID) == "" {
		writeErrCode(w, 403, "forbidden", "forbidden")
		return
	}
	if pinned == nil || *pinned != msgID {
		writeJSON(w, 200, map[string]any{"ok": true})
		return
	}
	_, _ = s.db.Exec(r.Context(), `UPDATE conversations SET pinned_message_id=NULL WHERE id=$1`, convID)
	s.hub.PublishToUsers(s.memberIDs(r, convID), ws.Event{
		Type: "message.unpinned",
		Payload: map[string]any{"conversation_id": convID, "message_id": msgID},
	})
	writeJSON(w, 200, map[string]any{"ok": true})
}
