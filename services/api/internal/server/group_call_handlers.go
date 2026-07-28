package server

import (
	"context"
	"net/http"

	"github.com/qchat/qchat/services/api/internal/ws"
)

// handleInviteToCall adds members to an active/ringing group call and rings them.
func (s *Server) handleInviteToCall(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	callID := r.PathValue("id")
	call, err := s.loadCall(r, callID)
	if err != nil {
		writeErrCode(w, 404, "not_found", "call not found")
		return
	}
	if call.Status != "ringing" && call.Status != "active" {
		writeErrCode(w, 409, "invalid_state", "call is not active")
		return
	}
	if !s.callIsGroup(r.Context(), call.ConversationID) {
		writeErrCode(w, 400, "group_only", "invite is only for group calls")
		return
	}
	role := s.memberRole(r, call.ConversationID, c.UserID)
	if role == "" || role == "pending" {
		writeErrCode(w, 403, "forbidden", "not a conversation member")
		return
	}
	myPart := s.callParticipantStatus(r.Context(), callID, c.UserID)
	if c.UserID != call.InitiatorID && myPart != "joined" {
		writeErrCode(w, 403, "forbidden", "only call participants can invite")
		return
	}

	var req struct {
		InviteeIDs []string `json:"invitee_ids"`
	}
	if err := decodeJSON(r, &req); err != nil || len(req.InviteeIDs) == 0 {
		writeErrCode(w, 400, "invalid_request", "invitee_ids required")
		return
	}

	members := s.memberIDs(r, call.ConversationID)
	memberSet := map[string]bool{}
	for _, m := range members {
		memberSet[m] = true
	}

	var invited []string
	seen := map[string]bool{}
	for _, raw := range req.InviteeIDs {
		id := trimSpace(raw)
		if id == "" || id == c.UserID || seen[id] {
			continue
		}
		if !memberSet[id] {
			writeErrCode(w, 400, "invalid_invitee", "invitee must be a group member")
			return
		}
		st := s.callParticipantStatus(r.Context(), callID, id)
		if st == "kicked" {
			writeErrCode(w, 403, "denied", "host denied this member for this call")
			return
		}
		if st == "joined" || st == "invited" {
			continue
		}
		seen[id] = true
		s.upsertCallParticipant(r.Context(), callID, id, "invited", c.UserID)
		invited = append(invited, id)
	}
	if len(invited) == 0 {
		writeJSON(w, 200, map[string]any{"id": callID, "invitee_ids": []string{}})
		return
	}

	ringPayload := map[string]any{
		"id":               callID,
		"call_id":          callID,
		"room_name":        call.RoomName,
		"kind":             call.Kind,
		"livekit_url":      s.cfg.LiveKitURL,
		"conversation_id":  call.ConversationID,
		"initiator_id":     call.InitiatorID,
		"initiator_name":   s.userDisplayName(r, c.UserID),
		"initiator_avatar": s.userAvatarURL(r, c.UserID),
		"status":           call.Status,
		"by":               c.UserID,
		"is_group":         true,
	}
	s.hub.PublishToUsers(invited, ws.Event{Type: "call.ring", Payload: ringPayload})
	s.goPushJob(func() {
		s.notifyCallRingPush(
			context.Background(),
			invited,
			call.Kind,
			s.userDisplayName(r, c.UserID),
			callID,
			call.ConversationID,
		)
	})

	writeJSON(w, 200, map[string]any{
		"id": callID, "call_id": callID, "invitee_ids": invited, "status": call.Status,
	})
}

// handleKickFromCall lets the call host remove a participant (deny for this session).
func (s *Server) handleKickFromCall(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	callID := r.PathValue("id")
	call, err := s.loadCall(r, callID)
	if err != nil {
		writeErrCode(w, 404, "not_found", "call not found")
		return
	}
	if call.Status != "ringing" && call.Status != "active" {
		writeErrCode(w, 409, "invalid_state", "call is not active")
		return
	}
	if !s.callIsGroup(r.Context(), call.ConversationID) {
		writeErrCode(w, 400, "group_only", "kick is only for group calls")
		return
	}
	if call.InitiatorID != c.UserID {
		writeErrCode(w, 403, "forbidden", "only the call host can remove members")
		return
	}

	var req struct {
		UserID string `json:"user_id"`
	}
	if err := decodeJSON(r, &req); err != nil || trimSpace(req.UserID) == "" {
		writeErrCode(w, 400, "invalid_request", "user_id required")
		return
	}
	target := trimSpace(req.UserID)
	if target == c.UserID {
		writeErrCode(w, 400, "invalid_request", "cannot kick yourself")
		return
	}

	s.upsertCallParticipant(r.Context(), callID, target, "kicked", c.UserID)

	payload := map[string]any{
		"id": callID, "call_id": callID, "kind": call.Kind,
		"conversation_id": call.ConversationID, "initiator_id": call.InitiatorID,
		"status": "kicked", "reason": "kicked", "by": c.UserID, "user_id": target,
		"is_group": true, "participant_name": s.userDisplayName(r, target),
	}
	s.hub.PublishToUsers(s.memberIDs(r, call.ConversationID), ws.Event{
		Type: "call.participant_kicked", Payload: payload,
	})
	writeJSON(w, 200, payload)
}
