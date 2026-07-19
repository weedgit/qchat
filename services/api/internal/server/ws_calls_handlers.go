package server

import (
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/qchat/qchat/services/api/internal/auth"
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
		s.hub.Unregister(c)
		_ = c.Conn.Close()
	}()
	c.Conn.SetReadLimit(1 << 20)
	_ = c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.Conn.SetPongHandler(func(string) error {
		_ = c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})
	for {
		_, _, err := c.Conn.ReadMessage()
		if err != nil {
			break
		}
	}
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
	// LiveKit-ready payload (token issuance wired in production)
	payload := map[string]any{
		"id":              id.String(),
		"room_name":       room,
		"kind":            req.Kind,
		"livekit_url":     "wss://livekit.example.local",
		"livekit_token":   "stub-token-" + id.String(),
		"conversation_id": req.ConversationID,
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
