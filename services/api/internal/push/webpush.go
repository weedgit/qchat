package push

import (
	"context"
	"encoding/json"
	"log"

	webpush "github.com/SherClockHolmes/webpush-go"
)

type Config struct {
	VAPIDPublic  string
	VAPIDPrivate string
	Subject      string // mailto: or https:

	// Expo Push (optional fallback; FCM/APNs under the hood — weak in China mainland).
	ExpoPushEnabled string
	ExpoAccessToken string

	// Native FCM HTTP v1 (non-Expo Android tokens).
	FCMProjectID       string
	FCMCredentialsJSON string // path to service-account JSON, or raw JSON

	// Native APNs HTTP/2 (.p8 key).
	APNsKeyID      string
	APNsTeamID     string
	APNsBundleID   string
	APNsKeyPath    string
	APNsProduction string // "1"/"true" = production; otherwise sandbox

	// Getui 个推 — primary China-mainland push (OEM channels via Getui console).
	GetuiEnabledFlag  string
	GetuiAppID        string
	GetuiAppKey       string
	GetuiMasterSecret string
}

type Subscription struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
}

// WebPayload is the JSON shown by apps/web/public/sw.js (desktop wake).
type WebPayload struct {
	Title          string `json:"title"`
	Body           string `json:"body"`
	Tag            string `json:"tag"`
	Type           string `json:"type,omitempty"` // message|call|friend
	Icon           string `json:"icon,omitempty"` // absolute URL only; SW cannot attach auth
	URL            string `json:"url,omitempty"`
	CallID         string `json:"call_id,omitempty"`
	ConversationID string `json:"conversation_id,omitempty"`
}

func (c Config) WebEnabled() bool {
	return c.VAPIDPublic != "" && c.VAPIDPrivate != ""
}

// Enabled is true when any push backend can deliver (web, Expo, FCM, or APNs).
func (c Config) Enabled() bool {
	return c.AnyEnabled()
}

// SendWeb pushes a notification and returns the HTTP status from the push service.
// Callers use 404/410 to remove expired browser subscriptions.
func SendWeb(ctx context.Context, cfg Config, subscriptionJSON string, p WebPayload) (int, error) {
	if !cfg.WebEnabled() {
		return 0, nil
	}
	var sub webpush.Subscription
	if err := json.Unmarshal([]byte(subscriptionJSON), &sub); err != nil {
		return 0, err
	}
	if p.Type == "" {
		p.Type = "message"
	}
	payload, _ := json.Marshal(p)
	subject := cfg.Subject
	if subject == "" {
		subject = "mailto:admin@qchat.local"
	}
	ttl := 60
	if p.Type == "call" {
	// Cover ring window (~30s) so a backgrounded tab can still wake.
		ttl = 35
	}
	resp, err := webpush.SendNotificationWithContext(ctx, payload, &sub, &webpush.Options{
		Subscriber:      subject,
		VAPIDPublicKey:  cfg.VAPIDPublic,
		VAPIDPrivateKey: cfg.VAPIDPrivate,
		TTL:             ttl,
		Urgency:         webpush.UrgencyHigh,
	})
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		log.Printf("webpush status %d", resp.StatusCode)
	}
	return resp.StatusCode, nil
}
