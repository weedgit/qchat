package sms

import (
	"context"
	"fmt"
	"log"
	"strings"

	"github.com/qchat/qchat/services/api/internal/config"
)

// Sender delivers verification codes. Prefer SendOTP; free-form Send remains for
// adapters that only accept a preformatted body (legacy / outbox logging).
type Sender interface {
	SendOTP(ctx context.Context, phone, code string) error
}

// DevSender logs codes and is suitable for local development.
type DevSender struct{}

func (DevSender) SendOTP(_ context.Context, phone, code string) error {
	log.Printf("[sms:dev] to=%s body=%s", phone, FormatPhoneCode(code))
	return nil
}

// unconfiguredSender fails every send. A gateway that is named but has no
// driver / credentials must surface as a delivery error rather than silently
// discarding verification codes.
type unconfiguredSender struct{ provider string }

func (u unconfiguredSender) SendOTP(context.Context, string, string) error {
	return fmt.Errorf("sms provider %q is not configured", u.provider)
}

// NewFromConfig resolves the configured gateway.
//
//	dev / ""  — log only
//	twilio    — Twilio REST
//	aliyun    — Aliyun Dysmsapi (template)
//	router    — CN mobiles → Aliyun, everything else → Twilio
func NewFromConfig(cfg config.Config) Sender {
	switch strings.ToLower(strings.TrimSpace(cfg.SMSProvider)) {
	case "", "dev":
		return DevSender{}
	case "twilio":
		s, err := newTwilio(cfg)
		if err != nil {
			return unconfiguredSender{provider: "twilio: " + err.Error()}
		}
		return s
	case "aliyun":
		s, err := newAliyun(cfg)
		if err != nil {
			return unconfiguredSender{provider: "aliyun: " + err.Error()}
		}
		return s
	case "router":
		s, err := newRouter(cfg)
		if err != nil {
			return unconfiguredSender{provider: "router: " + err.Error()}
		}
		return s
	default:
		return unconfiguredSender{provider: cfg.SMSProvider}
	}
}

// New is kept for older call sites / tests that only pass a provider name.
func New(provider string) Sender {
	return NewFromConfig(config.Config{SMSProvider: provider})
}

func FormatPhoneCode(code string) string {
	return fmt.Sprintf("Your Rchat verification code is %s. It expires in 10 minutes.", code)
}
