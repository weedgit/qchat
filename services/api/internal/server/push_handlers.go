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
		VAPIDPublic:        s.cfg.VAPIDPublic,
		VAPIDPrivate:       s.cfg.VAPIDPrivate,
		Subject:            s.cfg.VAPIDSubject,
		ExpoPushEnabled:    s.cfg.ExpoPushEnabled,
		ExpoAccessToken:    s.cfg.ExpoAccessToken,
		FCMProjectID:       s.cfg.FCMProjectID,
		FCMCredentialsJSON: s.cfg.FCMCredentialsJSON,
		APNsKeyID:          s.cfg.APNsKeyID,
		APNsTeamID:         s.cfg.APNsTeamID,
		APNsBundleID:       s.cfg.APNsBundleID,
		APNsKeyPath:        s.cfg.APNsKeyPath,
		APNsProduction:     s.cfg.APNsProduction,
		GetuiEnabledFlag:   s.cfg.GetuiEnabled,
		GetuiAppID:         s.cfg.GetuiAppID,
		GetuiAppKey:        s.cfg.GetuiAppKey,
		GetuiMasterSecret:  s.cfg.GetuiMasterSecret,
	}
}

func (s *Server) handlePushVAPID(w http.ResponseWriter, r *http.Request) {
	cfg := s.pushCfg()
	writeJSON(w, 200, map[string]any{
		"public_key": s.cfg.VAPIDPublic,
		"enabled":    cfg.WebEnabled(),
		"adapters":   cfg.EnabledAdapters(),
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
	case "web", "ios", "android", "getui", "huawei", "xiaomi", "oppo", "vivo", "honor", "meizu":
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
	cfg := s.pushCfg()
	out := map[string]any{
		"ok":       true,
		"adapters": cfg.EnabledAdapters(),
	}
	if !cfg.GetuiEnabled() {
		out["oem_deferred"] = []string{"huawei", "xiaomi", "oppo", "vivo", "honor", "meizu"}
	} else {
		out["oem_via"] = "getui"
	}
	writeJSON(w, 200, out)
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
		SELECT id::text, platform, token FROM push_devices
		WHERE user_id=$1`, userID)
	if err != nil {
		return
	}
	devices := make([]push.Device, 0)
	for rows.Next() {
		var d push.Device
		if rows.Scan(&d.ID, &d.Platform, &d.Token) != nil {
			continue
		}
		devices = append(devices, d)
	}
	rows.Close()
	for _, d := range devices {
		status, err := push.Dispatch(ctx, cfg, d, p)
		if err == nil && (status == http.StatusNotFound || status == http.StatusGone) {
			_, _ = s.db.Exec(ctx, `DELETE FROM push_devices WHERE id::text=$1`, d.ID)
		}
	}
}

// notifyMessagePush fans out Telegram-style "Sender → Recipient" message pushes
// (getPushNotificationMessage puts the sender in the notification title).
// Respects conversation mute and user notify_props (desktop=mention / mentions_only).
// Recipients with an active WebSocket are skipped (in-app delivery already happened).
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

	candidates := make([]string, 0, len(memberIDs))
	for _, uid := range memberIDs {
		if uid == senderID {
			continue
		}
		// Online sockets already got message.new; skip vendor push under load.
		if s.hub.IsOnline(uid) {
			continue
		}
		candidates = append(candidates, uid)
	}
	if len(candidates) == 0 {
		return
	}

	rows, err := s.db.Query(ctx, `
		SELECT cm.user_id::text, cm.muted,
		       COALESCE(u.notify_props, '{}'::jsonb),
		       COALESCE(u.display_name, '')
		FROM conversation_members cm
		JOIN users u ON u.id = cm.user_id
		WHERE cm.conversation_id = $1
		  AND cm.user_id::text = ANY($2::text[])`, convID, candidates)
	if err != nil {
		return
	}
	defer rows.Close()

	type memberPref struct {
		uid, displayName, desktop string
		muted, mentionsOnly       bool
	}
	prefs := make([]memberPref, 0, len(candidates))
	for rows.Next() {
		var uid, displayName string
		var muted bool
		var raw []byte
		if rows.Scan(&uid, &muted, &raw, &displayName) != nil {
			continue
		}
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
		prefs = append(prefs, memberPref{
			uid: uid, displayName: displayName, desktop: desktop,
			muted: muted, mentionsOnly: mentionsOnly,
		})
	}

	for _, p := range prefs {
		if p.muted {
			continue
		}
		_, isMention := mentioned[p.uid]
		if mentionAll {
			isMention = true
		}
		if p.desktop == "none" {
			continue
		}
		if p.desktop == "mention" || p.mentionsOnly {
			if !isMention {
				continue
			}
		}
		title := senderName
		if convType == "dm" {
			if p.displayName != "" {
				title = senderName + " → " + p.displayName
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
		}
		s.pushToUser(ctx, cfg, p.uid, push.WebPayload{
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

// notifyFriendRequestPush wakes the addressee when they have no live WebSocket
// (in-app / desktop clients already surface friend.request over WS).
func (s *Server) notifyFriendRequestPush(ctx context.Context, userID, fromName, fromUsername string) {
	cfg := s.pushCfg()
	if !cfg.Enabled() {
		return
	}
	if userID == "" || s.hub.IsOnline(userID) {
		return
	}
	// Honour global desktop=none notify_props.
	var raw []byte
	_ = s.db.QueryRow(ctx, `SELECT COALESCE(notify_props, '{}'::jsonb) FROM users WHERE id=$1`, userID).Scan(&raw)
	if len(raw) > 0 {
		var props map[string]any
		if json.Unmarshal(raw, &props) == nil {
			if d, ok := props["desktop"].(string); ok && d == "none" {
				return
			}
		}
	}
	who := strings.TrimSpace(fromName)
	if who == "" {
		who = strings.TrimSpace(fromUsername)
		if who != "" {
			who = "@" + who
		}
	}
	if who == "" {
		who = "Someone"
	}
	s.pushToUser(ctx, cfg, userID, push.WebPayload{
		Title: "Friend request",
		Body:  who + " wants to add you as a contact",
		Tag:   "qchat-friend-request",
		Type:  "friend",
		URL:   "/friends",
	})
}

// notifyCallRingPush wakes callees via Web Push (Calls background notify).
// Skips users that already have a live WebSocket (they get call.ring over WS).
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
		if s.hub.IsOnline(uid) {
			continue
		}
		s.pushToUser(ctx, cfg, uid, p)
	}
}
