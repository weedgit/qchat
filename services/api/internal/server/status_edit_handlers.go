package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/qchat/qchat/services/api/internal/ws"
)

// handleUpdateStatus PUT /users/{user_id}/status.
func (s *Server) handleUpdateStatus(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	var req struct {
		Status string `json:"status"` // online|away|dnd|offline
		Text   string `json:"text"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErrCode(w, 400, "invalid_request", "invalid json")
		return
	}
	switch req.Status {
	case "online", "away", "dnd", "offline":
	default:
		writeErrCode(w, 400, "invalid_status", "status must be online, away, dnd, or offline")
		return
	}
	now := time.Now().UTC()
	_, err := s.db.Exec(r.Context(), `
		UPDATE users SET status=$2, status_text=$3, last_active_at=$4 WHERE id=$1`,
		c.UserID, req.Status, req.Text, now)
	if err != nil {
		writeErrCode(w, 500, "update_failed", "update failed")
		return
	}
	rows, _ := s.db.Query(r.Context(), `
		SELECT DISTINCT cm2.user_id::text
		FROM conversation_members cm1
		JOIN conversation_members cm2
		  ON cm2.conversation_id = cm1.conversation_id AND cm2.user_id <> cm1.user_id
		WHERE cm1.user_id=$1 AND cm1.role <> 'pending' AND cm2.role <> 'pending'`, c.UserID)
	var recipients []string
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var id string
			_ = rows.Scan(&id)
			recipients = append(recipients, id)
		}
	}
	s.hub.PublishToUsers(recipients, ws.Event{
		Type: "presence.update",
		Payload: map[string]any{
			"user_id":        c.UserID,
			"online":         req.Status == "online" || req.Status == "away" || req.Status == "dnd",
			"status":         req.Status,
			"status_text":    req.Text,
			"last_active_at": now,
		},
	})
	writeJSON(w, 200, map[string]any{"status": req.Status, "text": req.Text})
}

// handleNotifyPrefs user notify_props preferences.
func (s *Server) handleNotifyPrefs(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	if r.Method == http.MethodGet {
		var raw []byte
		_ = s.db.QueryRow(r.Context(), `SELECT notify_props FROM users WHERE id=$1`, c.UserID).Scan(&raw)
		var props map[string]any
		if err := json.Unmarshal(raw, &props); err != nil || props == nil {
			props = map[string]any{"desktop": "all", "sound": true, "mentions_only": false}
		}
		writeJSON(w, 200, props)
		return
	}
	var req map[string]any
	if err := decodeJSON(r, &req); err != nil {
		writeErrCode(w, 400, "invalid_request", "invalid json")
		return
	}
	b, _ := json.Marshal(req)
	_, err := s.db.Exec(r.Context(), `UPDATE users SET notify_props=$2 WHERE id=$1`, c.UserID, b)
	if err != nil {
		writeErrCode(w, 500, "update_failed", "update failed")
		return
	}
	writeJSON(w, 200, req)
}

// handleEditMessage PATCH post / edit post.
func (s *Server) handleEditMessage(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	msgID := r.PathValue("id")
	var req struct {
		Body string `json:"body"`
	}
	if err := decodeJSON(r, &req); err != nil || req.Body == "" {
		writeErrCode(w, 400, "invalid_request", "body required")
		return
	}
	if len([]rune(req.Body)) > 1000 {
		writeErrCode(w, 400, "too_long", "message too long")
		return
	}
	var convID, sender string
	var created time.Time
	err := s.db.QueryRow(r.Context(), `
		SELECT conversation_id::text, sender_id::text, created_at
		FROM messages WHERE id=$1 AND recalled=FALSE`, msgID).Scan(&convID, &sender, &created)
	if err != nil {
		writeErrCode(w, 404, "not_found", "not found")
		return
	}
	if sender != c.UserID {
		writeErrCode(w, 403, "forbidden", "only author can edit")
		return
	}
	if time.Since(created) > 48*time.Hour {
		writeErrCode(w, 400, "edit_window", "edit window expired")
		return
	}
	mentions, mentionAll := s.parseMentions(r, convID, c.EnterpriseID, req.Body)
	mentionLiteral := "{}"
	if len(mentions) > 0 {
		mentionLiteral = "{" + strings.Join(mentions, ",") + "}"
	}
	now := time.Now().UTC()
	_, err = s.db.Exec(r.Context(), `
		UPDATE messages SET body=$2, mentions=$3::uuid[], mention_all=$4, edited_at=$5
		WHERE id=$1`, msgID, req.Body, mentionLiteral, mentionAll, now)
	if err != nil {
		writeErrCode(w, 500, "update_failed", "update failed")
		return
	}
	payload := map[string]any{
		"id": msgID, "conversation_id": convID, "body": req.Body,
		"edited_at": now, "mentions": mentions, "mention_all": mentionAll,
	}
	s.hub.PublishToUsers(s.memberIDs(r, convID), ws.Event{Type: "message.updated", Payload: payload})
	writeJSON(w, 200, payload)
}
