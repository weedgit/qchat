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

func (c Config) Enabled() bool {
	return c.VAPIDPublic != "" && c.VAPIDPrivate != ""
}

// SendWeb pushes a notification to a stored Web Push subscription JSON.
func SendWeb(ctx context.Context, cfg Config, subscriptionJSON string, title, body, tag string) error {
	if !cfg.Enabled() {
		return nil
	}
	var sub webpush.Subscription
	if err := json.Unmarshal([]byte(subscriptionJSON), &sub); err != nil {
		return err
	}
	payload, _ := json.Marshal(map[string]string{
		"title": title,
		"body":  body,
		"tag":   tag,
	})
	subject := cfg.Subject
	if subject == "" {
		subject = "mailto:admin@qchat.local"
	}
	resp, err := webpush.SendNotificationWithContext(ctx, payload, &sub, &webpush.Options{
		Subscriber:      subject,
		VAPIDPublicKey:  cfg.VAPIDPublic,
		VAPIDPrivateKey: cfg.VAPIDPrivate,
		TTL:             60,
	})
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		log.Printf("webpush status %d", resp.StatusCode)
	}
	return nil
}
