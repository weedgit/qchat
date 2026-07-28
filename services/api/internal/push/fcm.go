package push

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// FCMEnabled when Firebase HTTP v1 credentials are configured.
func (c Config) FCMEnabled() bool {
	return strings.TrimSpace(c.FCMProjectID) != "" && strings.TrimSpace(c.FCMCredentialsJSON) != ""
}

var (
	fcmTokenMu     sync.Mutex
	fcmAccessToken string
	fcmTokenExpiry time.Time
)

// SendFCM delivers to a native FCM registration token (not Expo).
// Uses OAuth2 service-account JWT → access token → FCM HTTP v1.
// When credentials are missing, this is a no-op.
func SendFCM(ctx context.Context, cfg Config, deviceToken string, p WebPayload) (int, error) {
	if !cfg.FCMEnabled() {
		log.Printf("push: fcm skipped (not configured)")
		return 0, nil
	}
	if p.Type == "" {
		p.Type = "message"
	}
	access, err := fcmBearer(ctx, cfg.FCMCredentialsJSON)
	if err != nil {
		return 0, err
	}
	payload := map[string]any{
		"message": map[string]any{
			"token": deviceToken,
			"notification": map[string]any{
				"title": p.Title,
				"body":  p.Body,
			},
			"data": map[string]string{
				"type":            p.Type,
				"url":             p.URL,
				"tag":             p.Tag,
				"call_id":         p.CallID,
				"conversation_id": p.ConversationID,
			},
			"android": map[string]any{
				"priority": "HIGH",
			},
		},
	}
	body, _ := json.Marshal(payload)
	url := fmt.Sprintf("https://fcm.googleapis.com/v1/projects/%s/messages:send", cfg.FCMProjectID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Authorization", "Bearer "+access)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 12 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone {
		return resp.StatusCode, nil
	}
	if resp.StatusCode >= 400 {
		log.Printf("fcm status %d: %s", resp.StatusCode, truncate(string(raw), 200))
		return resp.StatusCode, fmt.Errorf("fcm status %d", resp.StatusCode)
	}
	return resp.StatusCode, nil
}

func fcmBearer(ctx context.Context, credPathOrJSON string) (string, error) {
	fcmTokenMu.Lock()
	defer fcmTokenMu.Unlock()
	if fcmAccessToken != "" && time.Now().Before(fcmTokenExpiry.Add(-30*time.Second)) {
		return fcmAccessToken, nil
	}
	raw := []byte(credPathOrJSON)
	if !bytes.HasPrefix(bytes.TrimSpace(raw), []byte("{")) {
		b, err := os.ReadFile(credPathOrJSON)
		if err != nil {
			return "", fmt.Errorf("read fcm credentials: %w", err)
		}
		raw = b
	}
	// Minimal google oauth JWT flow without pulling the full cloud SDK.
	token, exp, err := googleServiceAccountToken(ctx, raw, "https://www.googleapis.com/auth/firebase.messaging")
	if err != nil {
		return "", err
	}
	fcmAccessToken = token
	fcmTokenExpiry = exp
	return token, nil
}
