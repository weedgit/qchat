package sms

import (
	"context"
	"fmt"

	"github.com/qchat/qchat/services/api/internal/config"
)

// routerSender sends CN mobiles via Aliyun and all other numbers via Twilio.
type routerSender struct {
	cn      Sender
	intl    Sender
	cnLabel string
}

func newRouter(cfg config.Config) (*routerSender, error) {
	cn, err := newAliyun(cfg)
	if err != nil {
		return nil, fmt.Errorf("aliyun leg: %w", err)
	}
	intl, err := newTwilio(cfg)
	if err != nil {
		return nil, fmt.Errorf("twilio leg: %w", err)
	}
	return &routerSender{cn: cn, intl: intl, cnLabel: "aliyun"}, nil
}

func (r *routerSender) SendOTP(ctx context.Context, phone, code string) error {
	if IsChinaMobile(phone) {
		return r.cn.SendOTP(ctx, phone, code)
	}
	return r.intl.SendOTP(ctx, phone, code)
}

// RouteLabel returns which gateway would handle phone (for tests / logging).
func RouteLabel(phone string) string {
	if IsChinaMobile(phone) {
		return "aliyun"
	}
	return "twilio"
}
