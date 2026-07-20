package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/qchat/qchat/services/api/internal/auth"
	"github.com/qchat/qchat/services/api/internal/livekit"
	"github.com/qchat/qchat/services/api/internal/ws"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token == "" {
		h := r.Header.Get("Authorization")
		token = strings.TrimPrefix(h, "Bearer ")
	}
	claims, err := auth.ParseAccess(s.cfg.JWTSecret, token)
	if err != nil {
		writeErr(w, 401, "unauthorized")
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	client := &ws.Client{
		UserID:       claims.UserID,
		EnterpriseID: claims.EnterpriseID,
		SessionID:    claims.SessionID,
		Conn:         conn,
		Send:         make(chan []byte, 64),
	}
	s.hub.Register(client)
	go s.writePump(client)
	// Mattermost-style presence: publish status_change when the first session connects.
	if s.hub.ConnectionCount(claims.UserID) == 1 {
		s.publishPresence(claims.UserID, true)
	}
	s.readPump(client)
}

func (s *Server) writePump(c *ws.Client) {
	defer func() {
		_ = c.Conn.Close()
	}()
	for msg := range c.Send {
		_ = c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if err := c.Conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			return
		}
	}
}

func (s *Server) readPump(c *ws.Client) {
	defer func() {
		uid := c.UserID
		s.hub.Unregister(c)
		_ = c.Conn.Close()
		// Only mark offline when the last session disconnects (Mattermost status_change).
		if !s.hub.IsOnline(uid) {
			s.publishPresence(uid, false)
		}
	}()
	c.Conn.SetReadLimit(1 << 20)
	_ = c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.Conn.SetPongHandler(func(string) error {
		_ = c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})
	for {
		_, data, err := c.Conn.ReadMessage()
		if err != nil {
			break
		}
		s.handleClientWS(c, data)
	}
}

// publishPresence mirrors Mattermost BroadcastStatus / status_change for conversation peers.
func (s *Server) publishPresence(userID string, online bool) {
	ctx := context.Background()
	now := time.Now().UTC()
	status := "offline"
	if online {
		status = "online"
	}
	_, _ = s.db.Exec(ctx, `UPDATE users SET last_active_at=$2, status=$3 WHERE id=$1`, userID, now, status)
	rows, err := s.db.Query(ctx, `
		SELECT DISTINCT cm2.user_id::text
		FROM conversation_members cm1
		JOIN conversation_members cm2
		  ON cm2.conversation_id = cm1.conversation_id AND cm2.user_id <> cm1.user_id
		WHERE cm1.user_id=$1 AND cm1.role <> 'pending' AND cm2.role <> 'pending'`, userID)
	if err != nil {
		return
	}
	defer rows.Close()
	var recipients []string
	for rows.Next() {
		var id string
		_ = rows.Scan(&id)
		recipients = append(recipients, id)
	}
	if len(recipients) == 0 {
		return
	}
	var statusText string
	_ = s.db.QueryRow(ctx, `SELECT COALESCE(status_text,'') FROM users WHERE id=$1`, userID).Scan(&statusText)
	s.hub.PublishToUsers(recipients, ws.Event{
		Type: "presence.update",
		Payload: map[string]any{
			"user_id":        userID,
			"online":         online,
			"status":         status,
			"status_text":    statusText,
			"last_active_at": now,
		},
	})
}

func (s *Server) handleClientWS(c *ws.Client, data []byte) {
	var msg struct {
		Type    string          `json:"type"`
		Payload json.RawMessage `json:"payload"`
	}
	if err := json.Unmarshal(data, &msg); err != nil || msg.Type == "" {
		return
	}
	switch msg.Type {
	case "typing.start", "typing.stop":
		var p struct {
			ConversationID string `json:"conversation_id"`
		}
		if err := json.Unmarshal(msg.Payload, &p); err != nil || p.ConversationID == "" {
			return
		}
		s.broadcastTyping(c, msg.Type, p.ConversationID)
	}
}

func (s *Server) broadcastTyping(c *ws.Client, eventType, convID string) {
	ctx := context.Background()
	var role string
	err := s.db.QueryRow(ctx, `
		SELECT role FROM conversation_members
		WHERE conversation_id=$1 AND user_id=$2 AND role <> 'pending'`,
		convID, c.UserID).Scan(&role)
	if err != nil || role == "" {
		return
	}
	var name string
	_ = s.db.QueryRow(ctx, `SELECT display_name FROM users WHERE id=$1`, c.UserID).Scan(&name)
	if name == "" {
		name = "Someone"
	}
	rows, err := s.db.Query(ctx, `
		SELECT user_id::text FROM conversation_members
		WHERE conversation_id=$1 AND role <> 'pending' AND user_id <> $2`, convID, c.UserID)
	if err != nil {
		return
	}
	defer rows.Close()
	var recipients []string
	for rows.Next() {
		var id string
		_ = rows.Scan(&id)
		recipients = append(recipients, id)
	}
	if len(recipients) == 0 {
		return
	}
	s.hub.PublishToUsers(recipients, ws.Event{
		Type: eventType,
		Payload: map[string]any{
			"conversation_id": convID,
			"user_id":         c.UserID,
			"user_name":       name,
		},
	})
}

func (s *Server) handleStartCall(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	var req struct {
		ConversationID string `json:"conversation_id"`
		Kind           string `json:"kind"` // voice|video
	}
	if err := decodeJSON(r, &req); err != nil || req.ConversationID == "" {
		writeErr(w, 400, "conversation_id required")
		return
	}
	if req.Kind == "" {
		req.Kind = "voice"
	}
	id := uuid.New()
	room := "qchat-" + id.String()
	_, err := s.db.Exec(r.Context(), `
		INSERT INTO call_sessions(id, conversation_id, initiator_id, kind, room_name, status)
		VALUES ($1,$2,$3,$4,$5,'ringing')`, id, req.ConversationID, c.UserID, req.Kind, room)
	if err != nil {
		writeErr(w, 500, "create failed")
		return
	}
	lk := livekit.TokenConfig{
		URL:       s.cfg.LiveKitURL,
		APIKey:    s.cfg.LiveKitAPIKey,
		APISecret: s.cfg.LiveKitAPISecret,
	}
	var displayName string
	_ = s.db.QueryRow(r.Context(), `SELECT display_name FROM users WHERE id=$1`, c.UserID).Scan(&displayName)
	token, tokErr := livekit.MintJoinToken(lk, room, c.UserID, displayName, time.Hour)
	if tokErr != nil {
		writeErrCode(w, 503, "livekit_unavailable", "livekit not configured")
		return
	}
	payload := map[string]any{
		"id":              id.String(),
		"room_name":       room,
		"kind":            req.Kind,
		"livekit_url":     lk.URL,
		"livekit_token":   token,
		"conversation_id": req.ConversationID,
		"initiator_id":    c.UserID,
		"status":          "ringing",
	}
	s.hub.PublishToUsers(s.memberIDs(r, req.ConversationID), ws.Event{Type: "call.ring", Payload: payload})
	writeJSON(w, 201, payload)
}

func (s *Server) handlePushRegister(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	var req struct {
		Platform string `json:"platform"`
		Token    string `json:"token"`
	}
	if err := decodeJSON(r, &req); err != nil || req.Token == "" {
		writeErr(w, 400, "token required")
		return
	}
	switch req.Platform {
	case "web", "ios", "android", "huawei", "xiaomi", "oppo", "vivo":
	default:
		writeErr(w, 400, "unsupported platform")
		return
	}
	_, err := s.db.Exec(r.Context(), `
		INSERT INTO push_devices(user_id, platform, token) VALUES ($1,$2,$3)
		ON CONFLICT (user_id, token) DO UPDATE SET platform=EXCLUDED.platform`, c.UserID, req.Platform, req.Token)
	if err != nil {
		writeErr(w, 500, "register failed")
		return
	}
	writeJSON(w, 200, map[string]any{
		"ok": true,
		"adapters": []string{"web-push", "apns", "fcm", "huawei", "xiaomi", "oppo", "vivo"},
	})
}
