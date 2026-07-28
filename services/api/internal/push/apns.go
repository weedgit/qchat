package push

import (
	"context"
	"crypto/ecdsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// APNsEnabled when .p8 key + Apple identifiers are configured.
func (c Config) APNsEnabled() bool {
	return strings.TrimSpace(c.APNsKeyID) != "" &&
		strings.TrimSpace(c.APNsTeamID) != "" &&
		strings.TrimSpace(c.APNsBundleID) != "" &&
		strings.TrimSpace(c.APNsKeyPath) != ""
}

var (
	apnsTokenMu     sync.Mutex
	apnsBearer      string
	apnsBearerExpiry time.Time
)

// SendAPNs delivers to a native APNs device token (hex). Expo tokens should use SendExpo.
func SendAPNs(ctx context.Context, cfg Config, deviceToken string, p WebPayload) (int, error) {
	if !cfg.APNsEnabled() {
		log.Printf("push: apns skipped (not configured)")
		return 0, nil
	}
	if p.Type == "" {
		p.Type = "message"
	}
	bearer, err := apnsJWT(cfg)
	if err != nil {
		return 0, err
	}
	host := "https://api.push.apple.com"
	if strings.EqualFold(cfg.APNsProduction, "0") || strings.EqualFold(cfg.APNsProduction, "false") {
		host = "https://api.sandbox.push.apple.com"
	}
	payload := map[string]any{
		"aps": map[string]any{
			"alert": map[string]any{
				"title": p.Title,
				"body":  p.Body,
			},
			"sound": "default",
		},
		"type":            p.Type,
		"url":             p.URL,
		"tag":             p.Tag,
		"call_id":         p.CallID,
		"conversation_id": p.ConversationID,
	}
	body, _ := json.Marshal(payload)
	url := fmt.Sprintf("%s/3/device/%s", host, deviceToken)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, strings.NewReader(string(body)))
	if err != nil {
		return 0, err
	}
	req.Header.Set("authorization", "bearer "+bearer)
	req.Header.Set("apns-topic", cfg.APNsBundleID)
	req.Header.Set("apns-push-type", "alert")
	req.Header.Set("apns-priority", "10")
	client := &http.Client{Timeout: 12 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode == http.StatusGone || resp.StatusCode == http.StatusNotFound {
		return resp.StatusCode, nil
	}
	if resp.StatusCode >= 400 {
		log.Printf("apns status %d: %s", resp.StatusCode, truncate(string(raw), 200))
		return resp.StatusCode, fmt.Errorf("apns status %d", resp.StatusCode)
	}
	return resp.StatusCode, nil
}

func apnsJWT(cfg Config) (string, error) {
	apnsTokenMu.Lock()
	defer apnsTokenMu.Unlock()
	if apnsBearer != "" && time.Now().Before(apnsBearerExpiry.Add(-30*time.Second)) {
		return apnsBearer, nil
	}
	pemBytes, err := os.ReadFile(cfg.APNsKeyPath)
	if err != nil {
		return "", fmt.Errorf("read apns key: %w", err)
	}
	block, _ := pem.Decode(pemBytes)
	if block == nil {
		return "", fmt.Errorf("apns key: no PEM block")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return "", fmt.Errorf("parse apns key: %w", err)
	}
	key, ok := parsed.(*ecdsa.PrivateKey)
	if !ok {
		return "", fmt.Errorf("apns key: expected ECDSA private key")
	}
	now := time.Now()
	token := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.MapClaims{
		"iss": cfg.APNsTeamID,
		"iat": now.Unix(),
	})
	token.Header["kid"] = cfg.APNsKeyID
	signed, err := token.SignedString(key)
	if err != nil {
		return "", err
	}
	apnsBearer = signed
	apnsBearerExpiry = now.Add(50 * time.Minute)
	return signed, nil
}
