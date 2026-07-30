package server

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/qchat/qchat/services/api/internal/livekit"
	"github.com/qchat/qchat/services/api/internal/ws"
)

// ringTimeout is 30s — unanswered ringing ends as missed (DM / group with no join).
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

func (s *Server) userAvatarURL(r *http.Request, userID string) string {
	var avatar string
	_ = s.db.QueryRow(r.Context(), `SELECT COALESCE(avatar_url, '') FROM users WHERE id=$1`, userID).Scan(&avatar)
	return avatar
}

func (s *Server) mintCallToken(r *http.Request, room, userID, deviceID string) (string, error) {
	identity := userID
	if deviceID != "" {
		identity = userID + ":" + deviceID
	}
	return livekit.MintJoinToken(s.livekitCfg(), room, identity, s.userDisplayName(r, userID), time.Hour)
}

func (s *Server) upsertCallParticipant(ctx context.Context, callID, userID, status, invitedBy string) {
	_, _ = s.db.Exec(ctx, `
		INSERT INTO call_participants(call_id, user_id, status, invited_by)
		VALUES ($1,$2,$3, NULLIF($4,'')::uuid)
		ON CONFLICT (call_id, user_id) DO UPDATE
		SET status=$3, updated_at=now(),
		    invited_by=COALESCE(NULLIF($4,'')::uuid, call_participants.invited_by)`,
		callID, userID, status, invitedBy)
}

func (s *Server) callParticipantStatus(ctx context.Context, callID, userID string) string {
	var st string
	_ = s.db.QueryRow(ctx, `
		SELECT status FROM call_participants WHERE call_id=$1 AND user_id=$2`,
		callID, userID).Scan(&st)
	return st
}

func (s *Server) callIsGroup(ctx context.Context, conversationID string) bool {
	var typ string
	_ = s.db.QueryRow(ctx, `SELECT type FROM conversations WHERE id=$1`, conversationID).Scan(&typ)
	return typ == "social_group" || typ == "group"
}

// handleStartCall starts a DM 1:1 or group call (LiveKit SFU).
// Group requires invitee_ids (selected members); only those are rung.
func (s *Server) handleStartCall(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	var req struct {
		ConversationID string   `json:"conversation_id"`
		Kind           string   `json:"kind"` // voice|video
		InviteeIDs     []string `json:"invitee_ids"`
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
	isGroup := convType == "social_group" || convType == "group"
	if convType != "dm" && !isGroup {
		writeErrCode(w, 400, "unsupported", "calls only supported in DM or group chats")
		return
	}

	members := s.memberIDs(r, req.ConversationID)
	memberSet := map[string]bool{}
	for _, m := range members {
		memberSet[m] = true
	}

	var invitees []string
	if isGroup {
		seen := map[string]bool{}
		for _, id := range req.InviteeIDs {
			id = trimSpace(id)
			if id == "" || id == c.UserID || seen[id] {
				continue
			}
			if !memberSet[id] {
				writeErrCode(w, 400, "invalid_invitee", "invitee must be a group member")
				return
			}
			seen[id] = true
			invitees = append(invitees, id)
		}
		if len(invitees) == 0 {
			writeErrCode(w, 400, "invitees_required", "select at least one member to invite")
			return
		}
	} else {
		for _, m := range members {
			if m != c.UserID {
				invitees = append(invitees, m)
			}
		}
		if len(invitees) == 0 {
			writeErrCode(w, 400, "no_peer", "DM has no peer")
			return
		}
	}

	// Only clear unanswered ringing leftovers. Never auto-kill an active call —
	// starting a second group video was ending everyone's in-progress session.
	var activeCallID string
	_ = s.db.QueryRow(r.Context(), `
		SELECT id::text FROM call_sessions
		WHERE conversation_id=$1 AND status='active'
		ORDER BY COALESCE(answered_at, created_at) DESC
		LIMIT 1`, req.ConversationID).Scan(&activeCallID)
	if activeCallID != "" {
		if isGroup {
			writeErrCode(w, 409, "call_in_progress",
				"a call is already in progress in this group — join or invite to that call instead of starting a new one")
			return
		}
		// DM: replace the previous 1:1 session so a new dial can proceed.
		_, _ = s.db.Exec(r.Context(), `
			UPDATE call_sessions SET status='ended', ended_at=COALESCE(ended_at, now())
			WHERE id=$1 AND status='active'`, activeCallID)
		s.hub.PublishToUsers(members, ws.Event{
			Type: "call.ended",
			Payload: map[string]any{
				"id": activeCallID, "call_id": activeCallID, "conversation_id": req.ConversationID,
				"status": "ended", "reason": "replaced", "by": c.UserID,
			},
		})
	}

	rows, _ := s.db.Query(r.Context(), `
		SELECT id::text FROM call_sessions
		WHERE conversation_id=$1 AND status='ringing'`, req.ConversationID)
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
			WHERE conversation_id=$1 AND status='ringing'`, req.ConversationID)
		for _, sid := range staleIDs {
			s.hub.PublishToUsers(members, ws.Event{
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
	initiatorDevice := c.DeviceID
	_, err := s.db.Exec(r.Context(), `
		INSERT INTO call_sessions(id, conversation_id, initiator_id, initiator_device_id, kind, room_name, status)
		VALUES ($1,$2,$3,$4,$5,$6,'ringing')`, id, req.ConversationID, c.UserID, initiatorDevice, req.Kind, room)
	if err != nil {
		writeErrCode(w, 500, "create_failed", "create failed")
		return
	}

	callID := id.String()
	s.upsertCallParticipant(r.Context(), callID, c.UserID, "joined", c.UserID)
	for _, uid := range invitees {
		s.upsertCallParticipant(r.Context(), callID, uid, "invited", c.UserID)
	}

	token, tokErr := s.mintCallToken(r, room, c.UserID, initiatorDevice)
	if tokErr != nil {
		writeErrCode(w, 503, "livekit_unavailable", "token mint failed")
		return
	}

	ringPayload := map[string]any{
		"id":                  callID,
		"call_id":             callID,
		"room_name":           room,
		"kind":                req.Kind,
		"livekit_url":         s.cfg.LiveKitURL,
		"conversation_id":     req.ConversationID,
		"initiator_id":        c.UserID,
		"initiator_name":      s.userDisplayName(r, c.UserID),
		"initiator_avatar":    s.userAvatarURL(r, c.UserID),
		"initiator_device_id": initiatorDevice,
		"status":              "ringing",
		"by":                  c.UserID,
		"is_group":            isGroup,
	}
	s.hub.PublishToUsers(invitees, ws.Event{Type: "call.ring", Payload: ringPayload})

	s.goPushJob(func() {
		s.notifyCallRingPush(
			context.Background(),
			invitees,
			req.Kind,
			s.userDisplayName(r, c.UserID),
			callID,
			req.ConversationID,
		)
	})

	s.scheduleRingTimeout(callID)

	writeJSON(w, 201, map[string]any{
		"id":                  callID,
		"call_id":             callID,
		"room_name":           room,
		"kind":                req.Kind,
		"livekit_url":         s.cfg.LiveKitURL,
		"livekit_token":       token,
		"conversation_id":     req.ConversationID,
		"initiator_id":        c.UserID,
		"initiator_device_id": initiatorDevice,
		"status":              "ringing",
		"is_group":            isGroup,
		"invitee_ids":         invitees,
	})
}

func trimSpace(s string) string {
	return strings.TrimSpace(s)
}

func (s *Server) scheduleRingTimeout(callID string) {
	time.AfterFunc(ringTimeout, func() {
		s.expireMissedRing(callID)
	})
}

// expireMissedRing ends a still-ringing session after ringTimeout (nobody joined).
func (s *Server) expireMissedRing(callID string) {
	ctx := context.Background()
	var call callRow
	err := s.db.QueryRow(ctx, `
		SELECT id::text, conversation_id::text, initiator_id::text,
		       COALESCE(initiator_device_id,''), COALESCE(answerer_device_id,''),
		       kind, room_name, status, created_at, answered_at
		FROM call_sessions WHERE id=$1 AND status='ringing'`, callID).
		Scan(&call.ID, &call.ConversationID, &call.InitiatorID, &call.InitiatorDeviceID, &call.AnswererDeviceID,
			&call.Kind, &call.RoomName, &call.Status, &call.CreatedAt, &call.AnsweredAt)
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
	ID                string
	ConversationID    string
	InitiatorID       string
	InitiatorDeviceID string
	AnswererDeviceID  string
	Kind              string
	RoomName          string
	Status            string
	CreatedAt         time.Time
	AnsweredAt        *time.Time
}

func (s *Server) loadCall(r *http.Request, callID string) (*callRow, error) {
	var row callRow
	err := s.db.QueryRow(r.Context(), `
		SELECT id::text, conversation_id::text, initiator_id::text,
		       COALESCE(initiator_device_id,''), COALESCE(answerer_device_id,''),
		       kind, room_name, status, created_at, answered_at
		FROM call_sessions WHERE id=$1`, callID).
		Scan(&row.ID, &row.ConversationID, &row.InitiatorID, &row.InitiatorDeviceID, &row.AnswererDeviceID,
			&row.Kind, &row.RoomName, &row.Status, &row.CreatedAt, &row.AnsweredAt)
	if err != nil {
		return nil, err
	}
	return &row, nil
}

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

// handleAnswerCall accepts an invite (DM or group). Group allows answer while ringing or active.
func (s *Server) handleAnswerCall(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	callID := r.PathValue("id")
	call, err := s.loadCall(r, callID)
	if err != nil {
		writeErrCode(w, 404, "not_found", "call not found")
		return
	}
	isGroup := s.callIsGroup(r.Context(), call.ConversationID)
	if call.Status != "ringing" && !(isGroup && call.Status == "active") {
		writeErrCode(w, 409, "invalid_state", "call is not joinable")
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

	partStatus := s.callParticipantStatus(r.Context(), callID, c.UserID)
	if partStatus == "kicked" {
		writeErrCode(w, 403, "denied", "host removed you from this call")
		return
	}
	if isGroup && partStatus != "invited" && partStatus != "joined" {
		// Allow legacy rows without participants for DM; group must be invited.
		if partStatus == "" {
			writeErrCode(w, 403, "not_invited", "you were not invited to this call")
			return
		}
		if partStatus == "declined" || partStatus == "left" {
			writeErrCode(w, 403, "not_invited", "invite no longer valid")
			return
		}
	}

	if call.Status == "ringing" {
		tag, err := s.db.Exec(r.Context(), `
			UPDATE call_sessions
			SET status='active', answered_at=now(), answerer_device_id=$2
			WHERE id=$1 AND status='ringing'`, callID, c.DeviceID)
		if err != nil || tag.RowsAffected() == 0 {
			// Another answer may have won the race — reload if now active (group).
			call2, err2 := s.loadCall(r, callID)
			if err2 != nil || call2.Status != "active" || !isGroup {
				writeErrCode(w, 409, "invalid_state", "call is not ringing")
				return
			}
			call = call2
		} else {
			call.AnswererDeviceID = c.DeviceID
			call.Status = "active"
		}
	}

	s.upsertCallParticipant(r.Context(), callID, c.UserID, "joined", "")

	calleeTok, err := s.mintCallToken(r, call.RoomName, c.UserID, c.DeviceID)
	if err != nil {
		writeErrCode(w, 503, "livekit_unavailable", "token mint failed")
		return
	}

	base := map[string]any{
		"id":                  call.ID,
		"call_id":             call.ID,
		"room_name":           call.RoomName,
		"kind":                call.Kind,
		"livekit_url":         s.cfg.LiveKitURL,
		"conversation_id":     call.ConversationID,
		"initiator_id":        call.InitiatorID,
		"initiator_device_id": call.InitiatorDeviceID,
		"answerer_device_id":  c.DeviceID,
		"status":              "active",
		"by":                  c.UserID,
		"is_group":            isGroup,
		"participant_name":    s.userDisplayName(r, c.UserID),
		"participant_avatar":  s.userAvatarURL(r, c.UserID),
	}

	if !isGroup {
		callerTok, err := s.mintCallToken(r, call.RoomName, call.InitiatorID, call.InitiatorDeviceID)
		if err != nil {
			writeErrCode(w, 503, "livekit_unavailable", "token mint failed")
			return
		}
		callerPayload := map[string]any{}
		for k, v := range base {
			callerPayload[k] = v
		}
		callerPayload["livekit_token"] = callerTok
		s.hub.PublishToUserDevice(call.InitiatorID, call.InitiatorDeviceID, ws.Event{
			Type: "call.answered", Payload: callerPayload,
		})
	} else {
		// Notify existing participants that someone joined (no token).
		s.hub.PublishToUsers(s.memberIDs(r, call.ConversationID), ws.Event{
			Type: "call.participant_joined", Payload: base,
		})
		// First answer: tell initiator to connect if still ringing-side.
		if call.InitiatorDeviceID != "" {
			callerTok, err := s.mintCallToken(r, call.RoomName, call.InitiatorID, call.InitiatorDeviceID)
			if err == nil {
				callerPayload := map[string]any{}
				for k, v := range base {
					callerPayload[k] = v
				}
				callerPayload["livekit_token"] = callerTok
				s.hub.PublishToUserDevice(call.InitiatorID, call.InitiatorDeviceID, ws.Event{
					Type: "call.answered", Payload: callerPayload,
				})
			}
		}
	}

	taken := map[string]any{}
	for k, v := range base {
		taken[k] = v
	}
	taken["reason"] = "answered_elsewhere"
	s.hub.PublishToUserExceptDevice(c.UserID, c.DeviceID, ws.Event{
		Type: "call.taken", Payload: taken,
	})

	if !isGroup {
		others := []string{}
		for _, m := range s.memberIDs(r, call.ConversationID) {
			if m != call.InitiatorID && m != c.UserID {
				others = append(others, m)
			}
		}
		if len(others) > 0 {
			s.hub.PublishToUsers(others, ws.Event{Type: "call.answered", Payload: base})
		}
	}

	resp := map[string]any{}
	for k, v := range base {
		resp[k] = v
	}
	resp["livekit_token"] = calleeTok
	writeJSON(w, 200, resp)
}

// handleDeclineCall rejects an invite. Group: only this user; call continues for others.
func (s *Server) handleDeclineCall(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	callID := r.PathValue("id")
	call, err := s.loadCall(r, callID)
	if err != nil {
		writeErrCode(w, 404, "not_found", "call not found")
		return
	}
	if call.Status != "ringing" && call.Status != "active" {
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

	isGroup := s.callIsGroup(r.Context(), call.ConversationID)
	s.upsertCallParticipant(r.Context(), callID, c.UserID, "declined", "")

	if isGroup {
		// If still ringing and no invitees remain invited, cancel the call.
		var pending int
		_ = s.db.QueryRow(r.Context(), `
			SELECT COUNT(*) FROM call_participants
			WHERE call_id=$1 AND status='invited'`, callID).Scan(&pending)
		var joinedOthers int
		_ = s.db.QueryRow(r.Context(), `
			SELECT COUNT(*) FROM call_participants
			WHERE call_id=$1 AND status='joined' AND user_id<>$2`, callID, call.InitiatorID).Scan(&joinedOthers)
		payload := map[string]any{
			"id": call.ID, "call_id": call.ID, "kind": call.Kind,
			"conversation_id": call.ConversationID, "initiator_id": call.InitiatorID,
			"status": "declined", "reason": "declined", "by": c.UserID, "is_group": true,
		}
		if call.Status == "ringing" && pending == 0 && joinedOthers == 0 {
			_, _ = s.db.Exec(r.Context(), `
				UPDATE call_sessions SET status='declined', ended_at=now()
				WHERE id=$1 AND status='ringing'`, callID)
			kindLabel := "Voice"
			if call.Kind == "video" {
				kindLabel = "Video"
			}
			s.postCallSystemMessage(r, call, kindLabel+" call declined", c.UserID)
			payload["status"] = "declined"
			s.hub.PublishToUsers(s.memberIDs(r, call.ConversationID), ws.Event{Type: "call.ended", Payload: payload})
		} else {
			s.hub.PublishToUsers([]string{call.InitiatorID, c.UserID}, ws.Event{
				Type: "call.participant_declined", Payload: payload,
			})
		}
		writeJSON(w, 200, payload)
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

// handleHangupCall: host/DM ends whole call; group non-host leaves only.
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
	if call.Status != "ringing" && call.Status != "active" {
		writeJSON(w, 200, map[string]any{
			"id": call.ID, "call_id": call.ID, "status": call.Status, "already_ended": true,
		})
		return
	}

	isGroup := s.callIsGroup(r.Context(), call.ConversationID)
	isHost := call.InitiatorID == c.UserID

	// Group participant leave (non-host): call continues.
	if isGroup && !isHost && call.Status == "active" {
		s.upsertCallParticipant(r.Context(), callID, c.UserID, "left", "")
		payload := map[string]any{
			"id": call.ID, "call_id": call.ID, "kind": call.Kind,
			"conversation_id": call.ConversationID, "initiator_id": call.InitiatorID,
			"status": "left", "reason": "left", "by": c.UserID, "is_group": true,
			"participant_name": s.userDisplayName(r, c.UserID),
		}
		s.hub.PublishToUsers(s.memberIDs(r, call.ConversationID), ws.Event{
			Type: "call.participant_left", Payload: payload,
		})
		writeJSON(w, 200, payload)
		return
	}

	reason := "ended"
	if call.Status == "ringing" && isHost {
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
		"is_group":        isGroup,
	}
	s.hub.PublishToUsers(s.memberIDs(r, call.ConversationID), ws.Event{Type: "call.ended", Payload: payload})
	writeJSON(w, 200, payload)
}
