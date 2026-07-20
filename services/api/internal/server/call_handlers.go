package server

import (
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/qchat/qchat/services/api/internal/livekit"
	"github.com/qchat/qchat/services/api/internal/ws"
)

func (s *Server) livekitCfg() livekit.TokenConfig {
	return livekit.TokenConfig{
		URL:       s.cfg.LiveKitURL,
		APIKey:    s.cfg.LiveKitAPIKey,
		APISecret: s.cfg.LiveKitAPISecret,
	}
}

func (s *Server) userDisplayName(r *http.Request, userID string) string {
	var name string
	_ = s.db.QueryRow(r.Context(), `SELECT display_name FROM users WHERE id=$1`, userID).Scan(&name)
	return name
}

func (s *Server) mintCallToken(r *http.Request, room, userID string) (string, error) {
	return livekit.MintJoinToken(s.livekitCfg(), room, userID, s.userDisplayName(r, userID), time.Hour)
}

// handleStartCall mirrors Mattermost Calls start / call_start for DM 1:1 (LiveKit SFU).
func (s *Server) handleStartCall(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	var req struct {
		ConversationID string `json:"conversation_id"`
		Kind           string `json:"kind"` // voice|video
	}
	if err := decodeJSON(r, &req); err != nil || req.ConversationID == "" {
		writeErrCode(w, 400, "invalid_request", "conversation_id required")
		return
	}
	if req.Kind == "" {
		req.Kind = "voice"
	}
	if req.Kind != "voice" && req.Kind != "video" {
		writeErrCode(w, 400, "invalid_kind", "kind must be voice or video")
		return
	}

	role := s.memberRole(r, req.ConversationID, c.UserID)
	if role == "" || role == "pending" {
		writeErrCode(w, 403, "forbidden", "not a conversation member")
		return
	}
	var convType string
	_ = s.db.QueryRow(r.Context(), `SELECT type FROM conversations WHERE id=$1`, req.ConversationID).Scan(&convType)
	if convType != "dm" {
		writeErrCode(w, 400, "dm_only", "1:1 calls are only supported in DMs")
		return
	}

	var existing string
	_ = s.db.QueryRow(r.Context(), `
		SELECT id::text FROM call_sessions
		WHERE conversation_id=$1 AND status IN ('ringing','active')
		ORDER BY created_at DESC LIMIT 1`, req.ConversationID).Scan(&existing)
	if existing != "" {
		writeErrCode(w, 409, "call_in_progress", "a call is already in progress")
		return
	}

	if !s.livekitCfg().Enabled() {
		writeErrCode(w, 503, "livekit_unavailable", "livekit not configured")
		return
	}

	id := uuid.New()
	room := "qchat-" + id.String()
	_, err := s.db.Exec(r.Context(), `
		INSERT INTO call_sessions(id, conversation_id, initiator_id, kind, room_name, status)
		VALUES ($1,$2,$3,$4,$5,'ringing')`, id, req.ConversationID, c.UserID, req.Kind, room)
	if err != nil {
		writeErrCode(w, 500, "create_failed", "create failed")
		return
	}

	token, tokErr := s.mintCallToken(r, room, c.UserID)
	if tokErr != nil {
		writeErrCode(w, 503, "livekit_unavailable", "token mint failed")
		return
	}

	// Ring payload without caller's media token (callee gets token on answer).
	ringPayload := map[string]any{
		"id":              id.String(),
		"call_id":         id.String(),
		"room_name":       room,
		"kind":            req.Kind,
		"livekit_url":     s.cfg.LiveKitURL,
		"conversation_id": req.ConversationID,
		"initiator_id":    c.UserID,
		"initiator_name":  s.userDisplayName(r, c.UserID),
		"status":          "ringing",
		"by":              c.UserID,
	}
	members := s.memberIDs(r, req.ConversationID)
	var others []string
	for _, m := range members {
		if m != c.UserID {
			others = append(others, m)
		}
	}
	s.hub.PublishToUsers(others, ws.Event{Type: "call.ring", Payload: ringPayload})

	writeJSON(w, 201, map[string]any{
		"id":              id.String(),
		"call_id":         id.String(),
		"room_name":       room,
		"kind":            req.Kind,
		"livekit_url":     s.cfg.LiveKitURL,
		"livekit_token":   token,
		"conversation_id": req.ConversationID,
		"initiator_id":    c.UserID,
		"status":          "ringing",
	})
}

type callRow struct {
	ID             string
	ConversationID string
	InitiatorID    string
	Kind           string
	RoomName       string
	Status         string
	CreatedAt      time.Time
}

func (s *Server) loadCall(r *http.Request, callID string) (*callRow, error) {
	var row callRow
	err := s.db.QueryRow(r.Context(), `
		SELECT id::text, conversation_id::text, initiator_id::text, kind, room_name, status, created_at
		FROM call_sessions WHERE id=$1`, callID).
		Scan(&row.ID, &row.ConversationID, &row.InitiatorID, &row.Kind, &row.RoomName, &row.Status, &row.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// handleAnswerCall mirrors Mattermost join / accept incoming ring.
func (s *Server) handleAnswerCall(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	callID := r.PathValue("id")
	call, err := s.loadCall(r, callID)
	if err != nil {
		writeErrCode(w, 404, "not_found", "call not found")
		return
	}
	if call.Status != "ringing" {
		writeErrCode(w, 409, "invalid_state", "call is not ringing")
		return
	}
	if call.InitiatorID == c.UserID {
		writeErrCode(w, 400, "cannot_answer_own", "initiator cannot answer")
		return
	}
	role := s.memberRole(r, call.ConversationID, c.UserID)
	if role == "" || role == "pending" {
		writeErrCode(w, 403, "forbidden", "not a conversation member")
		return
	}

	tag, err := s.db.Exec(r.Context(), `
		UPDATE call_sessions SET status='active' WHERE id=$1 AND status='ringing'`, callID)
	if err != nil || tag.RowsAffected() == 0 {
		writeErrCode(w, 409, "invalid_state", "call is not ringing")
		return
	}

	calleeTok, err := s.mintCallToken(r, call.RoomName, c.UserID)
	if err != nil {
		writeErrCode(w, 503, "livekit_unavailable", "token mint failed")
		return
	}
	callerTok, err := s.mintCallToken(r, call.RoomName, call.InitiatorID)
	if err != nil {
		writeErrCode(w, 503, "livekit_unavailable", "token mint failed")
		return
	}

	base := map[string]any{
		"id":              call.ID,
		"call_id":         call.ID,
		"room_name":       call.RoomName,
		"kind":            call.Kind,
		"livekit_url":     s.cfg.LiveKitURL,
		"conversation_id": call.ConversationID,
		"initiator_id":    call.InitiatorID,
		"status":          "active",
		"by":              c.UserID,
	}
	callerPayload := map[string]any{}
	for k, v := range base {
		callerPayload[k] = v
	}
	callerPayload["livekit_token"] = callerTok
	s.hub.PublishToUsers([]string{call.InitiatorID}, ws.Event{Type: "call.answered", Payload: callerPayload})

	others := []string{}
	for _, m := range s.memberIDs(r, call.ConversationID) {
		if m != call.InitiatorID && m != c.UserID {
			others = append(others, m)
		}
	}
	if len(others) > 0 {
		s.hub.PublishToUsers(others, ws.Event{Type: "call.answered", Payload: base})
	}

	resp := map[string]any{}
	for k, v := range base {
		resp[k] = v
	}
	resp["livekit_token"] = calleeTok
	writeJSON(w, 200, resp)
}

// handleDeclineCall rejects an incoming ring (Mattermost dismiss notification).
func (s *Server) handleDeclineCall(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	callID := r.PathValue("id")
	call, err := s.loadCall(r, callID)
	if err != nil {
		writeErrCode(w, 404, "not_found", "call not found")
		return
	}
	if call.Status != "ringing" {
		writeErrCode(w, 409, "invalid_state", "call is not ringing")
		return
	}
	if call.InitiatorID == c.UserID {
		writeErrCode(w, 400, "cannot_decline_own", "use hangup to cancel")
		return
	}
	role := s.memberRole(r, call.ConversationID, c.UserID)
	if role == "" || role == "pending" {
		writeErrCode(w, 403, "forbidden", "not a conversation member")
		return
	}

	_, _ = s.db.Exec(r.Context(), `
		UPDATE call_sessions SET status='declined', ended_at=now()
		WHERE id=$1 AND status='ringing'`, callID)

	payload := map[string]any{
		"id":              call.ID,
		"call_id":         call.ID,
		"kind":            call.Kind,
		"conversation_id": call.ConversationID,
		"initiator_id":    call.InitiatorID,
		"status":          "declined",
		"reason":          "declined",
		"by":              c.UserID,
	}
	s.hub.PublishToUsers(s.memberIDs(r, call.ConversationID), ws.Event{Type: "call.ended", Payload: payload})
	writeJSON(w, 200, payload)
}

// handleHangupCall ends an active or ringing call (Mattermost call_end / leave).
func (s *Server) handleHangupCall(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	callID := r.PathValue("id")
	call, err := s.loadCall(r, callID)
	if err != nil {
		writeErrCode(w, 404, "not_found", "call not found")
		return
	}
	if call.Status != "ringing" && call.Status != "active" {
		writeErrCode(w, 409, "invalid_state", "call already ended")
		return
	}
	role := s.memberRole(r, call.ConversationID, c.UserID)
	if role == "" || role == "pending" {
		writeErrCode(w, 403, "forbidden", "not a conversation member")
		return
	}

	reason := "ended"
	if call.Status == "ringing" && call.InitiatorID == c.UserID {
		reason = "cancelled"
	}

	_, _ = s.db.Exec(r.Context(), `
		UPDATE call_sessions SET status='ended', ended_at=now()
		WHERE id=$1 AND status IN ('ringing','active')`, callID)

	var endedAt *time.Time
	_ = s.db.QueryRow(r.Context(), `SELECT ended_at FROM call_sessions WHERE id=$1`, callID).Scan(&endedAt)
	durationSec := 0
	if call.Status == "active" && endedAt != nil {
		durationSec = int(endedAt.Sub(call.CreatedAt).Seconds())
		if durationSec < 0 {
			durationSec = 0
		}
	}

	payload := map[string]any{
		"id":              call.ID,
		"call_id":         call.ID,
		"kind":            call.Kind,
		"conversation_id": call.ConversationID,
		"initiator_id":    call.InitiatorID,
		"status":          "ended",
		"reason":          reason,
		"by":              c.UserID,
		"duration_sec":    durationSec,
	}
	s.hub.PublishToUsers(s.memberIDs(r, call.ConversationID), ws.Event{Type: "call.ended", Payload: payload})
	writeJSON(w, 200, payload)
}
