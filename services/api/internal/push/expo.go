package push

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

// ExpoEnabled when Expo Push API may be used (token-shaped devices).
// Access token is optional for basic throughput.
func (c Config) ExpoEnabled() bool {
	// Expo Push works without an access token for moderate volume.
	// Gate on an explicit opt-in so operators know mobile push is intentional.
	return strings.EqualFold(strings.TrimSpace(c.ExpoPushEnabled), "1") ||
		strings.EqualFold(strings.TrimSpace(c.ExpoPushEnabled), "true") ||
		c.ExpoAccessToken != ""
}

type expoMessage struct {
	To        string         `json:"to"`
	Title     string         `json:"title"`
	Body      string         `json:"body"`
	Sound     string         `json:"sound,omitempty"`
	Priority  string         `json:"priority,omitempty"`
	ChannelID string         `json:"channelId,omitempty"`
	Data      map[string]any `json:"data,omitempty"`
}

// SendExpo delivers via Expo's push service (FCM/APNs under the hood for Expo apps).
func SendExpo(ctx context.Context, cfg Config, expoPushToken string, p WebPayload) (int, error) {
	if !cfg.ExpoEnabled() {
		return 0, nil
	}
	if p.Type == "" {
		p.Type = "message"
	}
	msg := expoMessage{
		To:       expoPushToken,
		Title:    p.Title,
		Body:     p.Body,
		Sound:    "default",
		Priority: "high",
		Data: map[string]any{
			"type":            p.Type,
			"url":             p.URL,
			"tag":             p.Tag,
			"call_id":         p.CallID,
			"conversation_id": p.ConversationID,
		},
	}
	if p.Type == "message" {
		msg.ChannelID = "messages"
	}
	body, _ := json.Marshal([]expoMessage{msg})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://exp.host/--/api/v2/push/send", bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if cfg.ExpoAccessToken != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.ExpoAccessToken)
	}
	client := &http.Client{Timeout: 12 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 400 {
		log.Printf("expo push status %d: %s", resp.StatusCode, truncate(string(raw), 200))
		return resp.StatusCode, fmt.Errorf("expo push status %d", resp.StatusCode)
	}
	// Expo returns 200 with per-ticket errors for DeviceNotRegistered → treat as gone.
	var parsed struct {
		Data []struct {
			Status  string `json:"status"`
			Details struct {
				Error string `json:"error"`
			} `json:"details"`
		} `json:"data"`
	}
	if json.Unmarshal(raw, &parsed) == nil {
		for _, d := range parsed.Data {
			if d.Status == "error" && (d.Details.Error == "DeviceNotRegistered" || d.Details.Error == "InvalidCredentials") {
				return http.StatusGone, nil
			}
		}
	}
	return resp.StatusCode, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
