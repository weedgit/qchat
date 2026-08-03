package server

import (
	"net/http"

	"github.com/qchat/qchat/services/api/internal/ws"
)

// handleConversationPrefs favoriteChannel / muteChannel
// (notify_props) as per-member conversation preferences.
func (s *Server) handleConversationPrefs(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	convID := r.PathValue("id")
	role := s.memberRole(r, convID, c.UserID)
	if role == "" || role == "pending" {
		writeErrCode(w, 403, "forbidden", "forbidden")
		return
	}
	var req struct {
		Favorite *bool `json:"favorite"`
		Muted    *bool `json:"muted"`
	}
	if err := decodeJSON(r, &req); err != nil || (req.Favorite == nil && req.Muted == nil) {
		writeErrCode(w, 400, "invalid_request", "favorite or muted required")
		return
	}
	if req.Favorite != nil {
		_, err := s.db.Exec(r.Context(), `
			UPDATE conversation_members SET favorite=$3
			WHERE conversation_id=$1 AND user_id=$2`, convID, c.UserID, *req.Favorite)
		if err != nil {
			writeErrCode(w, 500, "update_failed", "update failed")
			return
		}
	}
	if req.Muted != nil {
		_, err := s.db.Exec(r.Context(), `
			UPDATE conversation_members SET muted=$3
			WHERE conversation_id=$1 AND user_id=$2`, convID, c.UserID, *req.Muted)
		if err != nil {
			writeErrCode(w, 500, "update_failed", "update failed")
			return
		}
	}
	var favorite, muted bool
	_ = s.db.QueryRow(r.Context(), `
		SELECT favorite, muted FROM conversation_members
		WHERE conversation_id=$1 AND user_id=$2`, convID, c.UserID).Scan(&favorite, &muted)
	writeJSON(w, 200, map[string]any{"id": convID, "favorite": favorite, "muted": muted})
}

// handleMarkUnread setUnreadPost / mark channel unread by
// rewinding last_read_seq so the conversation shows as unread again.
func (s *Server) handleMarkUnread(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	convID := r.PathValue("id")
	role := s.memberRole(r, convID, c.UserID)
	if role == "" || role == "pending" {
		writeErrCode(w, 403, "forbidden", "forbidden")
		return
	}
	var lastSeq int64
	_ = s.db.QueryRow(r.Context(), `
		SELECT COALESCE(MAX(seq), 0) FROM messages
		WHERE conversation_id=$1 AND recalled=FALSE`, convID).Scan(&lastSeq)
	target := lastSeq - 1
	if target < 0 {
		target = 0
	}
	_, err := s.db.Exec(r.Context(), `
		UPDATE conversation_members SET last_read_seq=$3
		WHERE conversation_id=$1 AND user_id=$2`, convID, c.UserID, target)
	if err != nil {
		writeErrCode(w, 500, "update_failed", "update failed")
		return
	}
	var unread int64
	_ = s.db.QueryRow(r.Context(), `
		SELECT COUNT(*)::bigint FROM messages
		WHERE conversation_id=$1 AND seq > $2 AND recalled=FALSE AND sender_id<>$3`,
		convID, target, c.UserID).Scan(&unread)
	writeJSON(w, 200, map[string]any{"id": convID, "last_read_seq": target, "unread_count": unread})
}

// handleClearHistory hides older messages for the current member only
// by advancing history_visible_from (Telegram-style "Clear history").
func (s *Server) handleClearHistory(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	convID := r.PathValue("id")
	role := s.memberRole(r, convID, c.UserID)
	if role == "" || role == "pending" {
		writeErrCode(w, 403, "forbidden", "forbidden")
		return
	}
	_, err := s.db.Exec(r.Context(), `
		UPDATE conversation_members SET history_visible_from=now()
		WHERE conversation_id=$1 AND user_id=$2`, convID, c.UserID)
	if err != nil {
		writeErrCode(w, 500, "update_failed", "update failed")
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "id": convID})
}

// handleDeleteConversation removes the current user from the chat list
// (membership delete). Group owners must transfer ownership / leave via group API.
func (s *Server) handleDeleteConversation(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	convID := r.PathValue("id")
	var typ, role string
	err := s.db.QueryRow(r.Context(), `
		SELECT conv.type, cm.role
		FROM conversation_members cm
		JOIN conversations conv ON conv.id=cm.conversation_id
		WHERE cm.conversation_id=$1 AND cm.user_id=$2`, convID, c.UserID).Scan(&typ, &role)
	if err != nil || role == "" || role == "pending" {
		writeErrCode(w, 404, "not_found", "not found")
		return
	}
	if (typ == "social_group" || typ == "group") && role == "owner" {
		writeErrCode(w, 403, "forbidden", "owner cannot delete; transfer ownership first")
		return
	}
	leftGroup := (typ == "social_group" || typ == "group") && role != "owner"
	_, err = s.db.Exec(r.Context(), `
		DELETE FROM conversation_members
		WHERE conversation_id=$1 AND user_id=$2`, convID, c.UserID)
	if err != nil {
		writeErrCode(w, 500, "delete_failed", "delete failed")
		return
	}
	if leftGroup {
		payload := map[string]any{
			"conversation_id": convID,
			"removed_user_id": c.UserID,
			"removed_by":      c.UserID,
			"left":            true,
		}
		s.hub.PublishToUsers([]string{c.UserID}, ws.Event{Type: "group.member_removed", Payload: payload})
		s.hub.PublishToUsers(s.adminIDs(r, convID), ws.Event{Type: "group.member_removed", Payload: payload})
		s.insertAdminMemberNotice(r, convID, c.UserID, c.UserID, "member_left")
	}
	writeJSON(w, 200, map[string]any{"ok": true, "id": convID})
}
