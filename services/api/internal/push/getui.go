package push

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Getui (个推) is the China-mainland push aggregator. When OEM channels
// (Huawei / Xiaomi / OPPO / vivo / Honor) are enabled in the Getui console,
// a single CID delivers via manufacturer services while the app is killed.

func (c Config) GetuiEnabled() bool {
	if c.GetuiAppID == "" || c.GetuiAppKey == "" || c.GetuiMasterSecret == "" {
		return false
	}
	v := strings.TrimSpace(c.GetuiEnabledFlag)
	if v == "" {
		return true // credentials present → on
	}
	return strings.EqualFold(v, "1") || strings.EqualFold(v, "true")
}

var (
	getuiMu        sync.Mutex
	getuiToken     string
	getuiExpireMs  int64
	getuiTokenApp  string
)

func getuiBaseURL(appID string) string {
	return "https://restapi.getui.com/v2/" + appID
}

func getuiAuthToken(ctx context.Context, cfg Config) (string, error) {
	getuiMu.Lock()
	defer getuiMu.Unlock()
	now := time.Now().UnixMilli()
	if getuiToken != "" && getuiTokenApp == cfg.GetuiAppID && now < getuiExpireMs-60_000 {
		return getuiToken, nil
	}
	ts := strconv.FormatInt(now, 10)
	sum := sha256.Sum256([]byte(cfg.GetuiAppKey + ts + cfg.GetuiMasterSecret))
	sign := hex.EncodeToString(sum[:])
	body, _ := json.Marshal(map[string]string{
		"sign":      sign,
		"timestamp": ts,
		"appkey":    cfg.GetuiAppKey,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, getuiBaseURL(cfg.GetuiAppID)+"/auth", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json;charset=utf-8")
	client := &http.Client{Timeout: 12 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var parsed struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
		Data struct {
			Token      string `json:"token"`
			ExpireTime string `json:"expire_time"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return "", fmt.Errorf("getui auth decode: %w", err)
	}
	if parsed.Code != 0 || parsed.Data.Token == "" {
		return "", fmt.Errorf("getui auth code=%d msg=%s", parsed.Code, parsed.Msg)
	}
	expire, _ := strconv.ParseInt(parsed.Data.ExpireTime, 10, 64)
	getuiToken = parsed.Data.Token
	getuiExpireMs = expire
	getuiTokenApp = cfg.GetuiAppID
	return getuiToken, nil
}

// SendGetui pushes to one ClientID via Getui REST v2 (covers OEM channels when configured).
func SendGetui(ctx context.Context, cfg Config, cid string, p WebPayload) (int, error) {
	if !cfg.GetuiEnabled() {
		return 0, nil
	}
	cid = strings.TrimSpace(cid)
	if cid == "" {
		return 0, nil
	}
	if p.Type == "" {
		p.Type = "message"
	}
	token, err := getuiAuthToken(ctx, cfg)
	if err != nil {
		return 0, err
	}

	payloadObj := map[string]any{
		"type":            p.Type,
		"url":             p.URL,
		"tag":             p.Tag,
		"call_id":         p.CallID,
		"conversation_id": p.ConversationID,
	}
	payloadBytes, _ := json.Marshal(payloadObj)
	payloadStr := string(payloadBytes)

	notif := map[string]any{
		"title":      p.Title,
		"body":       p.Body,
		"click_type": "startapp",
		"payload":    payloadStr,
	}
	reqBody := map[string]any{
		"request_id": fmt.Sprintf("q%x", time.Now().UnixNano()),
		"audience": map[string]any{
			"cid": []string{cid},
		},
		"settings": map[string]any{
			// Keep offline up to 24h so OEM wake can deliver after reconnect.
			"ttl": 86400000,
			"strategy": map[string]any{
				// 1 = prefer Getui channel then vendor.
				"default": 1,
			},
		},
		"push_message": map[string]any{
			"notification": notif,
		},
		// Manufacturer channel copy — required for killed-app wake on China OEMs
		// once Huawei/Xiaomi/OPPO/vivo/Honor are enabled in the Getui console.
		"push_channel": map[string]any{
			"android": map[string]any{
				"ups": map[string]any{
					"notification": notif,
				},
			},
			"ios": map[string]any{
				"type": "notify",
				"aps": map[string]any{
					"alert": map[string]any{
						"title": p.Title,
						"body":  p.Body,
					},
					"sound": "default",
				},
				"payload": payloadStr,
			},
		},
	}
	body, _ := json.Marshal(reqBody)
	status, raw, err := getuiPOST(ctx, cfg, token, "/push/single/cid", body)
	if err != nil {
		return status, err
	}
	var parsed struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}
	_ = json.Unmarshal(raw, &parsed)
	// 10001 = token expired → refresh once and retry.
	if parsed.Code == 10001 {
		getuiMu.Lock()
		getuiToken = ""
		getuiExpireMs = 0
		getuiMu.Unlock()
		token, err = getuiAuthToken(ctx, cfg)
		if err != nil {
			return 0, err
		}
		status, raw, err = getuiPOST(ctx, cfg, token, "/push/single/cid", body)
		if err != nil {
			return status, err
		}
		_ = json.Unmarshal(raw, &parsed)
	}
	if parsed.Code != 0 {
		log.Printf("getui push code=%d msg=%s body=%s", parsed.Code, parsed.Msg, truncate(string(raw), 200))
		// Target invalid / uninstalled
		if parsed.Code == 20001 || parsed.Code == 20002 {
			return http.StatusGone, nil
		}
		return status, fmt.Errorf("getui push code=%d", parsed.Code)
	}
	return status, nil
}

func getuiPOST(ctx context.Context, cfg Config, token, path string, body []byte) (int, []byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, getuiBaseURL(cfg.GetuiAppID)+path, bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", "application/json;charset=utf-8")
	req.Header.Set("token", token)
	client := &http.Client{Timeout: 12 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	return resp.StatusCode, raw, nil
}
