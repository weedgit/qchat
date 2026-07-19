package sms

import (
	"context"
	"fmt"
	"log"
	"os"
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

func NewFromEnv() Sender {
	switch os.Getenv("QCHAT_SMS_PROVIDER") {
	case "", "dev":
		return DevSender{}
	default:
		log.Printf("unknown QCHAT_SMS_PROVIDER %q; falling back to dev", os.Getenv("QCHAT_SMS_PROVIDER"))
		return DevSender{}
	}
}

func FormatPhoneCode(code string) string {
	return fmt.Sprintf("Your Qchat verification code is %s. It expires in 10 minutes.", code)
}
