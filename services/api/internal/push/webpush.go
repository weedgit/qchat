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
}

type Subscription struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
}

// WebPayload is the JSON shown by apps/web/public/sw.js (Mattermost-style desktop wake).
type WebPayload struct {
	Title          string `json:"title"`
	Body           string `json:"body"`
	Tag            string `json:"tag"`
	Type           string `json:"type,omitempty"` // message|call
	URL            string `json:"url,omitempty"`
	CallID         string `json:"call_id,omitempty"`
	ConversationID string `json:"conversation_id,omitempty"`
}

func (c Config) Enabled() bool {
	return c.VAPIDPublic != "" && c.VAPIDPrivate != ""
}

// SendWeb pushes a notification and returns the HTTP status from the push service.
// Callers use 404/410 to remove expired browser subscriptions.
func SendWeb(ctx context.Context, cfg Config, subscriptionJSON string, p WebPayload) (int, error) {
	if !cfg.Enabled() {
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
		// Cover Mattermost RING_LENGTH (~30s) so a backgrounded tab can still wake.
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
