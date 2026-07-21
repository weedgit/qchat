package server

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/qchat/qchat/services/api/internal/livekit"
	"github.com/qchat/qchat/services/api/internal/ws"
)

// ringTimeout matches Mattermost Calls RING_LENGTH (30s) — unanswered ringing ends as missed.
const ringTimeout = 30 * time.Second

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

	// 1:1: replace any leftover ringing/active session so redial works after media failures.
	rows, _ := s.db.Query(r.Context(), `
		SELECT id::text FROM call_sessions
		WHERE conversation_id=$1 AND status IN ('ringing','active')`, req.ConversationID)
	var staleIDs []string
	if rows != nil {
		for rows.Next() {
			var id string
			if rows.Scan(&id) == nil {
				staleIDs = append(staleIDs, id)
			}
		}
		rows.Close()
	}
	if len(staleIDs) > 0 {
		_, _ = s.db.Exec(r.Context(), `
			UPDATE call_sessions SET status='ended', ended_at=COALESCE(ended_at, now())
			WHERE conversation_id=$1 AND status IN ('ringing','active')`, req.ConversationID)
		for _, sid := range staleIDs {
			s.hub.PublishToUsers(s.memberIDs(r, req.ConversationID), ws.Event{
				Type: "call.ended",
				Payload: map[string]any{
					"id": sid, "call_id": sid, "conversation_id": req.ConversationID,
					"status": "ended", "reason": "replaced", "by": c.UserID,
				},
			})
		}
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

	// Mattermost Calls: wake backgrounded / closed tabs (Web Push + client Notification).
	go s.notifyCallRingPush(
		context.Background(),
		others,
		req.Kind,
		s.userDisplayName(r, c.UserID),
		id.String(),
		req.ConversationID,
	)

	// Mattermost RING_LENGTH: auto-end unanswered rings so caller/callee UIs clear.
	s.scheduleRingTimeout(id.String())

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

func (s *Server) scheduleRingTimeout(callID string) {
	time.AfterFunc(ringTimeout, func() {
		s.expireMissedRing(callID)
	})
}

// expireMissedRing ends a still-ringing session after RING_LENGTH (Mattermost-style miss).
func (s *Server) expireMissedRing(callID string) {
	ctx := context.Background()
	var call callRow
	err := s.db.QueryRow(ctx, `
		SELECT id::text, conversation_id::text, initiator_id::text, kind, room_name, status, created_at, answered_at
		FROM call_sessions WHERE id=$1 AND status='ringing'`, callID).
		Scan(&call.ID, &call.ConversationID, &call.InitiatorID, &call.Kind, &call.RoomName, &call.Status, &call.CreatedAt, &call.AnsweredAt)
	if err != nil {
		return
	}
	tag, err := s.db.Exec(ctx, `
		UPDATE call_sessions SET status='missed', ended_at=now()
		WHERE id=$1 AND status='ringing'`, callID)
	if err != nil || tag.RowsAffected() == 0 {
		return
	}

	kindLabel := "Voice"
	if call.Kind == "video" {
		kindLabel = "Video"
	}
	body := "Missed " + kindLabel + " call"
	s.postCallSystemMessageCtx(ctx, &call, body, call.InitiatorID)

	payload := map[string]any{
		"id":              call.ID,
		"call_id":         call.ID,
		"kind":            call.Kind,
		"conversation_id": call.ConversationID,
		"initiator_id":    call.InitiatorID,
		"status":          "missed",
		"reason":          "timeout",
		"by":              call.InitiatorID,
	}
	s.hub.PublishToUsers(s.memberIDsCtx(ctx, call.ConversationID), ws.Event{Type: "call.ended", Payload: payload})
}

type callRow struct {
	ID             string
	ConversationID string
	InitiatorID    string
	Kind           string
	RoomName       string
	Status         string
	CreatedAt      time.Time
	AnsweredAt     *time.Time
}

func (s *Server) loadCall(r *http.Request, callID string) (*callRow, error) {
	var row callRow
	err := s.db.QueryRow(r.Context(), `
		SELECT id::text, conversation_id::text, initiator_id::text, kind, room_name, status, created_at, answered_at
		FROM call_sessions WHERE id=$1`, callID).
		Scan(&row.ID, &row.ConversationID, &row.InitiatorID, &row.Kind, &row.RoomName, &row.Status, &row.CreatedAt, &row.AnsweredAt)
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// postCallSystemMessage mirrors Mattermost custom_calls posts in the timeline.
func (s *Server) postCallSystemMessage(r *http.Request, call *callRow, body string, byUserID string) {
	s.postCallSystemMessageCtx(r.Context(), call, body, byUserID)
}

func (s *Server) postCallSystemMessageCtx(ctx context.Context, call *callRow, body string, byUserID string) {
	var enterpriseID string
	_ = s.db.QueryRow(ctx, `SELECT enterprise_id::text FROM conversations WHERE id=$1`, call.ConversationID).Scan(&enterpriseID)
	if enterpriseID == "" {
		return
	}
	msgID := uuid.New()
	clientID := "call-" + call.ID
	var outID string
	var seq int64
	err := s.db.QueryRow(ctx, `
		INSERT INTO messages(id, conversation_id, enterprise_id, sender_id, client_msg_id, type, body)
		VALUES ($1,$2,$3,$4,$5,'call',$6)
		ON CONFLICT (conversation_id, client_msg_id) DO UPDATE SET body=EXCLUDED.body
		RETURNING id::text, seq`,
		msgID, call.ConversationID, enterpriseID, byUserID, clientID, body).Scan(&outID, &seq)
	if err != nil {
		return
	}
	s.hub.PublishToUsers(s.memberIDsCtx(ctx, call.ConversationID), ws.Event{
		Type: "message.new",
		Payload: map[string]any{
			"id": outID, "conversation_id": call.ConversationID, "sender_id": byUserID,
			"client_msg_id": clientID, "seq": seq, "type": "call", "body": body,
			"created_at": time.Now().UTC(),
		},
	})
}

func formatCallDuration(sec int) string {
	if sec < 60 {
		return fmt.Sprintf("%ds", sec)
	}
	m := sec / 60
	s := sec % 60
	if s == 0 {
		return fmt.Sprintf("%dm", m)
	}
	return fmt.Sprintf("%dm %ds", m, s)
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
		UPDATE call_sessions SET status='active', answered_at=now() WHERE id=$1 AND status='ringing'`, callID)
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

	kindLabel := "Voice"
	if call.Kind == "video" {
		kindLabel = "Video"
	}
	body := kindLabel + " call declined"
	s.postCallSystemMessage(r, call, body, c.UserID)

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
	role := s.memberRole(r, call.ConversationID, c.UserID)
	if role == "" || role == "pending" {
		writeErrCode(w, 403, "forbidden", "not a conversation member")
		return
	}
	// Idempotent: media-fail hangup + UI hangup (or both peers) may race.
	if call.Status != "ringing" && call.Status != "active" {
		writeJSON(w, 200, map[string]any{
			"id": call.ID, "call_id": call.ID, "status": call.Status, "already_ended": true,
		})
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
		start := call.CreatedAt
		if call.AnsweredAt != nil {
			start = *call.AnsweredAt
		}
		durationSec = int(endedAt.Sub(start).Seconds())
		if durationSec < 0 {
			durationSec = 0
		}
	}

	kindLabel := "Voice"
	if call.Kind == "video" {
		kindLabel = "Video"
	}
	var body string
	switch reason {
	case "cancelled":
		body = kindLabel + " call cancelled"
	case "declined":
		body = kindLabel + " call declined"
	default:
		if durationSec > 0 {
			body = fmt.Sprintf("%s call · %s", kindLabel, formatCallDuration(durationSec))
		} else {
			body = kindLabel + " call ended"
		}
	}
	s.postCallSystemMessage(r, call, body, c.UserID)

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
