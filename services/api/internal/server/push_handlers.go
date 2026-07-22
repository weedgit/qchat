package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

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
		Origin       string          `json:"origin"`
		DeviceName   string          `json:"device_name"`
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
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		origin = strings.TrimSpace(req.Origin)
	}
	deviceName := strings.TrimSpace(req.DeviceName)
	if len(deviceName) > 120 {
		deviceName = deviceName[:120]
	}
	_, err := s.db.Exec(r.Context(), `
		INSERT INTO push_devices(user_id, platform, token, origin, device_name, last_seen_at)
		VALUES ($1,$2,$3,$4,$5,now())
		ON CONFLICT (user_id, token) DO UPDATE SET
			platform=EXCLUDED.platform,
			origin=EXCLUDED.origin,
			device_name=EXCLUDED.device_name,
			last_seen_at=now()`,
		c.UserID, req.Platform, token, origin, deviceName)
	if err != nil {
		writeErr(w, 500, "register failed")
		return
	}
	writeJSON(w, 200, map[string]any{
		"ok":       true,
		"adapters": []string{"web-push", "apns", "fcm", "huawei", "xiaomi", "oppo", "vivo"},
	})
}

func (s *Server) handlePushDevices(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	rows, err := s.db.Query(r.Context(), `
		SELECT id::text, platform, COALESCE(origin,''), COALESCE(device_name,''),
		       created_at, COALESCE(last_seen_at, created_at)
		FROM push_devices
		WHERE user_id=$1
		ORDER BY COALESCE(last_seen_at, created_at) DESC`, c.UserID)
	if err != nil {
		writeErr(w, 500, "list push devices failed")
		return
	}
	defer rows.Close()
	devices := make([]map[string]any, 0)
	for rows.Next() {
		var id, platform, origin, deviceName string
		var createdAt, lastSeenAt time.Time
		if rows.Scan(&id, &platform, &origin, &deviceName, &createdAt, &lastSeenAt) != nil {
			continue
		}
		devices = append(devices, map[string]any{
			"id": id, "platform": platform, "origin": origin, "device_name": deviceName,
			"created_at": createdAt, "last_seen_at": lastSeenAt,
		})
	}
	writeJSON(w, 200, map[string]any{"devices": devices})
}

func (s *Server) handlePushDeviceDelete(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	tag, err := s.db.Exec(r.Context(), `
		DELETE FROM push_devices WHERE user_id=$1 AND id::text=$2`,
		c.UserID, r.PathValue("id"))
	if err != nil {
		writeErr(w, 500, "remove push device failed")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, 404, "push device not found")
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) handlePushUnregister(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	var req struct {
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
	_, _ = s.db.Exec(r.Context(), `
		DELETE FROM push_devices WHERE user_id=$1 AND token=$2`, c.UserID, token)
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) pushToUser(ctx context.Context, cfg push.Config, userID string, p push.WebPayload) {
	rows, err := s.db.Query(ctx, `
		SELECT id::text, token FROM push_devices
		WHERE platform='web' AND user_id=$1`, userID)
	if err != nil {
		return
	}
	type device struct {
		id    string
		token string
	}
	devices := make([]device, 0)
	for rows.Next() {
		var d device
		if rows.Scan(&d.id, &d.token) != nil {
			continue
		}
		devices = append(devices, d)
	}
	rows.Close()
	for _, d := range devices {
		status, err := push.SendWeb(ctx, cfg, d.token, p)
		if err == nil && (status == http.StatusNotFound || status == http.StatusGone) {
			_, _ = s.db.Exec(ctx, `DELETE FROM push_devices WHERE id::text=$1`, d.id)
		}
	}
}

// notifyMessagePush fans out Telegram-style "Sender → Recipient" message pushes
// (Mattermost getPushNotificationMessage puts the sender in the notification title).
// Respects conversation mute and user notify_props (desktop=mention / mentions_only).
func (s *Server) notifyMessagePush(
	ctx context.Context,
	convID, senderID, senderName, senderAvatar, preview string,
	memberIDs []string,
	mentionIDs []string,
	mentionAll bool,
) {
	cfg := s.pushCfg()
	if !cfg.Enabled() {
		return
	}
	if senderName == "" {
		senderName = "New message"
	}
	var convType, convTitle string
	_ = s.db.QueryRow(ctx, `SELECT type, COALESCE(title,'') FROM conversations WHERE id=$1`, convID).
		Scan(&convType, &convTitle)
	// Relative /v1/media avatars need auth, which the SW cannot attach.
	icon := ""
	if strings.HasPrefix(senderAvatar, "http://") || strings.HasPrefix(senderAvatar, "https://") {
		icon = senderAvatar
	}
	mentioned := map[string]struct{}{}
	for _, id := range mentionIDs {
		mentioned[id] = struct{}{}
	}
	for _, uid := range memberIDs {
		if uid == senderID {
			continue
		}
		var muted bool
		_ = s.db.QueryRow(ctx, `
			SELECT muted FROM conversation_members
			WHERE conversation_id=$1 AND user_id=$2`, convID, uid).Scan(&muted)
		if muted {
			continue
		}
		_, isMention := mentioned[uid]
		if mentionAll {
			isMention = true
		}
		var raw []byte
		_ = s.db.QueryRow(ctx, `SELECT notify_props FROM users WHERE id=$1`, uid).Scan(&raw)
		desktop := "all"
		mentionsOnly := false
		if len(raw) > 0 {
			var props map[string]any
			if json.Unmarshal(raw, &props) == nil {
				if d, ok := props["desktop"].(string); ok && d != "" {
					desktop = d
				}
				if m, ok := props["mentions_only"].(bool); ok {
					mentionsOnly = m
				}
			}
		}
		if desktop == "none" {
			continue
		}
		if desktop == "mention" || mentionsOnly {
			if !isMention {
				continue
			}
		}
		title := senderName
		if convType == "dm" {
			var recipient string
			_ = s.db.QueryRow(ctx, `SELECT display_name FROM users WHERE id=$1`, uid).Scan(&recipient)
			if recipient != "" {
				title = senderName + " → " + recipient
			}
		} else if convTitle != "" {
			title = senderName + " → " + convTitle
		}
		body := preview
		if isMention {
			if mentionAll {
				title = "Mentioned everyone · " + title
			} else {
				title = "Mentioned you · " + title
			}
			body = preview
		}
		s.pushToUser(ctx, cfg, uid, push.WebPayload{
			Title:          title,
			Body:           body,
			Tag:            "qchat-" + convID,
			Type:           "message",
			Icon:           icon,
			URL:            "/?c=" + convID,
			ConversationID: convID,
		})
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
