package server

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/qchat/qchat/services/api/internal/push"
)

func (s *Server) pushCfg() push.Config {
	return push.Config{
		VAPIDPublic:  s.cfg.VAPIDPublic,
		VAPIDPrivate: s.cfg.VAPIDPrivate,
		Subject:      s.cfg.VAPIDSubject,
	}
}

func (s *Server) handlePushVAPID(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{
		"public_key": s.cfg.VAPIDPublic,
		"enabled":    s.pushCfg().Enabled(),
	})
}

func (s *Server) handlePushRegister(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	var req struct {
		Platform     string          `json:"platform"`
		Token        string          `json:"token"`
		Subscription json.RawMessage `json:"subscription"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	token := req.Token
	if len(req.Subscription) > 0 {
		token = string(req.Subscription)
	}
	if token == "" {
		writeErr(w, 400, "token or subscription required")
		return
	}
	if req.Platform == "" {
		req.Platform = "web"
	}
	switch req.Platform {
	case "web", "ios", "android", "huawei", "xiaomi", "oppo", "vivo":
	default:
		writeErr(w, 400, "unsupported platform")
		return
	}
	_, err := s.db.Exec(r.Context(), `
		INSERT INTO push_devices(user_id, platform, token) VALUES ($1,$2,$3)
		ON CONFLICT (user_id, token) DO UPDATE SET platform=EXCLUDED.platform`, c.UserID, req.Platform, token)
	if err != nil {
		writeErr(w, 500, "register failed")
		return
	}
	writeJSON(w, 200, map[string]any{
		"ok": true,
		"adapters": []string{"web-push", "apns", "fcm", "huawei", "xiaomi", "oppo", "vivo"},
	})
}

func (s *Server) pushToUser(ctx context.Context, cfg push.Config, userID string, p push.WebPayload) {
	rows, err := s.db.Query(ctx, `SELECT token FROM push_devices WHERE platform='web' AND user_id=$1`, userID)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var token string
		if rows.Scan(&token) != nil {
			continue
		}
		_ = push.SendWeb(ctx, cfg, token, p)
	}
}

// notifyPush fans out Web Push to conversation members except sender (best-effort).
func (s *Server) notifyPush(ctx context.Context, memberIDs []string, exceptUserID, title, body, tag string) {
	cfg := s.pushCfg()
	if !cfg.Enabled() {
		return
	}
	p := push.WebPayload{Title: title, Body: body, Tag: tag, Type: "message"}
	for _, uid := range memberIDs {
		if uid == exceptUserID {
			continue
		}
		s.pushToUser(ctx, cfg, uid, p)
	}
}

// notifyCallRingPush wakes callees via Web Push (Mattermost Calls background notify).
func (s *Server) notifyCallRingPush(ctx context.Context, userIDs []string, kind, initiatorName, callID, conversationID string) {
	cfg := s.pushCfg()
	if !cfg.Enabled() {
		return
	}
	kindLabel := "Voice"
	if kind == "video" {
		kindLabel = "Video"
	}
	who := initiatorName
	if who == "" {
		who = "Someone"
	}
	title := "Incoming " + kindLabel + " call"
	body := who + " is calling"
	p := push.WebPayload{
		Title:          title,
		Body:           body,
		Tag:            "qchat-call-" + callID,
		Type:           "call",
		URL:            "/?c=" + conversationID,
		CallID:         callID,
		ConversationID: conversationID,
	}
	for _, uid := range userIDs {
		s.pushToUser(ctx, cfg, uid, p)
	}
}
