package server

import (
	"context"
	"fmt"
	"net/http"

	"github.com/qchat/qchat/services/api/internal/ws"
)

func pinnedPreview(typ, body string) string {
	if body != "" {
		return body
	}
	switch typ {
	case "image":
		return "Photo"
	case "voice":
		return "Voice message"
	case "file":
		return "File"
	default:
		return "Message"
	}
}

func pinItem(id, typ, body string, seq int64) map[string]any {
	return map[string]any{
		"id":   id,
		"type": typ,
		"body": pinnedPreview(typ, body),
		"seq":  seq,
	}
}

// canManagePins reports whether role may change a conversation's pin set.
// Groups reserve the pinned message for owners and administrators; ordinary
// members have no group-management permissions (requirements-en §2.3 rule 2).
// Both sides of a DM are stored as plain members, so either may pin.
func canManagePins(convType, role string) bool {
	if role == "" || role == "pending" {
		return false
	}
	if convType == "social_group" {
		return role == "owner" || role == "admin"
	}
	return true
}

// listPinnedMessages returns pins the viewer is allowed to see (requirements-en §9:
// new members cannot view message history from before they joined — including pins).
func (s *Server) listPinnedMessages(ctx context.Context, convID, viewerID string) []map[string]any {
	rows, err := s.db.Query(ctx, `
		SELECT m.id::text, m.type, m.body, m.seq
		FROM conversation_pins cp
		JOIN messages m ON m.id=cp.message_id
		JOIN conversation_members cm
		  ON cm.conversation_id=cp.conversation_id AND cm.user_id=$2
		WHERE cp.conversation_id=$1 AND m.recalled=FALSE
		  AND m.created_at >= cm.history_visible_from
		ORDER BY m.seq ASC`, convID, viewerID)
	if err != nil {
		return []map[string]any{}
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, typ, body string
		var seq int64
		if rows.Scan(&id, &typ, &body, &seq) != nil {
			continue
		}
		out = append(out, pinItem(id, typ, body, seq))
	}
	if out == nil {
		out = []map[string]any{}
	}
	return out
}

func (s *Server) loadPinsForConversations(ctx context.Context, convIDs []string, viewerID string) map[string][]map[string]any {
	out := map[string][]map[string]any{}
	if len(convIDs) == 0 {
		return out
	}
	rows, err := s.db.Query(ctx, `
		SELECT cp.conversation_id::text, m.id::text, m.type, m.body, m.seq
		FROM conversation_pins cp
		JOIN messages m ON m.id=cp.message_id
		JOIN conversation_members cm
		  ON cm.conversation_id=cp.conversation_id AND cm.user_id=$2
		WHERE cp.conversation_id = ANY($1::uuid[]) AND m.recalled=FALSE
		  AND m.created_at >= cm.history_visible_from
		ORDER BY m.seq ASC`, convIDs, viewerID)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var convID, id, typ, body string
		var seq int64
		if rows.Scan(&convID, &id, &typ, &body, &seq) != nil {
			continue
		}
		out[convID] = append(out[convID], pinItem(id, typ, body, seq))
	}
	return out
}

func (s *Server) publishPinsToMembers(r *http.Request, convID, eventType, msgID, typ, preview string, seq int64) {
	for _, uid := range s.memberIDs(r, convID) {
		pins := s.listPinnedMessages(r.Context(), convID, uid)
		payload := map[string]any{
			"conversation_id": convID,
			"pinned_messages": pins,
		}
		if eventType == "message.pinned" {
			payload["message_id"] = msgID
			payload["body"] = preview
			payload["type"] = typ
			payload["seq"] = seq
			// Only include pin details when this viewer can see the message.
			visible := false
			for _, p := range pins {
				if fmt.Sprint(p["id"]) == msgID {
					visible = true
					break
				}
			}
			if !visible {
				// Still refresh their pin set (without advertising the pre-join pin body).
				delete(payload, "body")
			}
		} else if msgID != "" {
			payload["message_id"] = msgID
		}
		s.hub.PublishToUsers([]string{uid}, ws.Event{Type: eventType, Payload: payload})
	}
}

// handlePinMessage POST /posts/{post_id}/pin.
// Adds to the conversation pin set (does not remove other pins).
func (s *Server) handlePinMessage(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	msgID := r.PathValue("id")
	var convID, enterpriseID, convType, typ, body string
	var seq int64
	err := s.db.QueryRow(r.Context(), `
		SELECT m.conversation_id::text, conv.enterprise_id::text, conv.type, m.type, m.body, m.seq
		FROM messages m JOIN conversations conv ON conv.id=m.conversation_id
		WHERE m.id=$1 AND m.recalled=FALSE`, msgID).Scan(&convID, &enterpriseID, &convType, &typ, &body, &seq)
	if err != nil {
		writeErrCode(w, 404, "not_found", "not found")
		return
	}
	if enterpriseID != c.EnterpriseID {
		writeErrCode(w, 403, "forbidden", "forbidden")
		return
	}
	if !canManagePins(convType, s.memberRole(r, convID, c.UserID)) {
		writeErrCode(w, 403, "forbidden", "forbidden")
		return
	}
	_, err = s.db.Exec(r.Context(), `
		INSERT INTO conversation_pins (conversation_id, message_id, pinned_by)
		VALUES ($1, $2, $3)
		ON CONFLICT (conversation_id, message_id) DO NOTHING`, convID, msgID, c.UserID)
	if err != nil {
		writeErrCode(w, 500, "update_failed", "update failed")
		return
	}
	// Keep legacy single-pin column pointing at the newest pin for older clients.
	_, _ = s.db.Exec(r.Context(), `UPDATE conversations SET pinned_message_id=$2 WHERE id=$1`, convID, msgID)

	pins := s.listPinnedMessages(r.Context(), convID, c.UserID)
	preview := pinnedPreview(typ, body)
	s.audit(r.Context(), c.UserID, c.EnterpriseID, "message.pin", "message", msgID, "", clientIP(r), map[string]any{
		"conversation_id":   convID,
		"conversation_type": convType,
	})
	s.publishPinsToMembers(r, convID, "message.pinned", msgID, typ, preview, seq)
	writeJSON(w, 200, map[string]any{
		"ok": true, "conversation_id": convID, "message_id": msgID,
		"body": preview, "type": typ, "pinned_messages": pins,
	})
}

// handleUnpinMessage POST /posts/{post_id}/unpin.
func (s *Server) handleUnpinMessage(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	msgID := r.PathValue("id")
	var convID, enterpriseID, convType string
	err := s.db.QueryRow(r.Context(), `
		SELECT m.conversation_id::text, conv.enterprise_id::text, conv.type
		FROM messages m JOIN conversations conv ON conv.id=m.conversation_id
		WHERE m.id=$1`, msgID).Scan(&convID, &enterpriseID, &convType)
	if err != nil {
		writeErrCode(w, 404, "not_found", "not found")
		return
	}
	if enterpriseID != c.EnterpriseID || !canManagePins(convType, s.memberRole(r, convID, c.UserID)) {
		writeErrCode(w, 403, "forbidden", "forbidden")
		return
	}
	tag, err := s.db.Exec(r.Context(), `
		DELETE FROM conversation_pins WHERE conversation_id=$1 AND message_id=$2`, convID, msgID)
	if err != nil {
		writeErrCode(w, 500, "update_failed", "update failed")
		return
	}
	_ = tag

	// Refresh legacy column to newest remaining pin (or clear).
	var next *string
	_ = s.db.QueryRow(r.Context(), `
		SELECT m.id::text FROM conversation_pins cp
		JOIN messages m ON m.id=cp.message_id
		WHERE cp.conversation_id=$1 AND m.recalled=FALSE
		ORDER BY cp.pinned_at DESC LIMIT 1`, convID).Scan(&next)
	if next != nil {
		_, _ = s.db.Exec(r.Context(), `UPDATE conversations SET pinned_message_id=$2 WHERE id=$1`, convID, *next)
	} else {
		_, _ = s.db.Exec(r.Context(), `UPDATE conversations SET pinned_message_id=NULL WHERE id=$1`, convID)
	}

	pins := s.listPinnedMessages(r.Context(), convID, c.UserID)
	s.publishPinsToMembers(r, convID, "message.unpinned", msgID, "", "", 0)
	writeJSON(w, 200, map[string]any{"ok": true, "pinned_messages": pins})
}
