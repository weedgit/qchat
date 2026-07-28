package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/qchat/qchat/services/api/internal/auth"
	"github.com/qchat/qchat/services/api/internal/ws"
)

// wsOriginAllowed ties WebSocket upgrades to the same origin policy as HTTP
// CORS (corsAllowOrigin). An empty Origin — sent by native clients such as the
// React Native app — is always permitted; browser origins must be allowed by
// QCHAT_CORS_ORIGIN. With the default "*" this stays fully permissive, so it is
// a no-op until an operator configures a real origin list.
func wsOriginAllowed(corsCfg, origin string) bool {
	return corsAllowOrigin(corsCfg, strings.TrimSpace(origin)) != ""
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
	if s.sessionAccessRevokedAny(claims.SessionID) || !s.sessionRowActive(r.Context(), claims.SessionID) {
		writeErr(w, 401, "session revoked")
		return
	}
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	client := &ws.Client{
		UserID:       claims.UserID,
		EnterpriseID: claims.EnterpriseID,
		SessionID:    claims.SessionID,
		DeviceID:     claims.DeviceID,
		Conn:         conn,
		Send:         make(chan []byte, ws.ClientSendBuffer),
	}
	s.hub.Register(client)
	s.touchSession(claims.SessionID)
	go s.writePump(client)
	// presence: publish status_change when the first session connects.
	if s.hub.ConnectionCount(claims.UserID) == 1 {
		uid := claims.UserID
		s.goPresenceJob(func() { s.publishPresence(uid, true) })
	}
	s.readPump(client)
}

func (s *Server) writePump(c *ws.Client) {
	// Keepalive so clients behind idle proxies stay up (WebSocket ping).
	ticker := time.NewTicker(25 * time.Second)
	defer func() {
		ticker.Stop()
		_ = c.Conn.Close()
	}()
	for {
		select {
		case msg, ok := <-c.Send:
			_ = c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				_ = c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.Conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (s *Server) readPump(c *ws.Client) {
	defer func() {
		uid := c.UserID
		s.hub.Unregister(c)
		_ = c.Conn.Close()
		// Only mark offline when the last session disconnects (status_change).
		if !s.hub.IsOnline(uid) {
			s.goPresenceJob(func() { s.publishPresence(uid, false) })
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
		// Extend deadline on any client frame (typing, etc.), not only pong.
		_ = c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		s.handleClientWS(c, data)
	}
}

// publishPresence BroadcastStatus / status_change for conversation peers.
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
