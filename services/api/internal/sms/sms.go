package sms

import (
	"context"
	"fmt"
	"log"
)

// Sender is a provider-neutral SMS interface.
type Sender interface {
	Send(ctx context.Context, phone, body string) error
}

// DevSender logs codes and is suitable for local development.
type DevSender struct{}

func (DevSender) Send(_ context.Context, phone, body string) error {
	log.Printf("[sms:dev] to=%s body=%s", phone, body)
	return nil
}

// unconfiguredSender fails every send. A gateway that is named but has no
// driver must surface as a delivery error rather than silently discarding
// verification codes while the caller reports success.
type unconfiguredSender struct{ provider string }

func (u unconfiguredSender) Send(context.Context, string, string) error {
	return fmt.Errorf("sms provider %q has no driver", u.provider)
}

// New resolves the configured gateway. Unknown providers fail closed instead
// of falling back to DevSender.
func New(provider string) Sender {
	switch provider {
	case "", "dev":
		return DevSender{}
	default:
		return unconfiguredSender{provider: provider}
	}
}

func FormatPhoneCode(code string) string {
	return fmt.Sprintf("Your Qchat verification code is %s. It expires in 10 minutes.", code)
}
