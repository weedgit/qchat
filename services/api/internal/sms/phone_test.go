package sms

import (
	"context"
	"testing"

	"github.com/qchat/qchat/services/api/internal/config"
)

func TestIsChinaMobile(t *testing.T) {
	cases := []struct {
		phone string
		want  bool
	}{
		{"13800000002", true},
		{"+86 138 0000 0002", true},
		{"008613800000002", true},
		{"8613800000002", true},
		{"12800000002", false},
		{"+1 555 123 4567", false},
		{"15551234567", true},
		{"447911123456", false},
		{"", false},
	}
	for _, tc := range cases {
		if got := IsChinaMobile(tc.phone); got != tc.want {
			t.Fatalf("IsChinaMobile(%q)=%v want %v", tc.phone, got, tc.want)
		}
	}
}

func TestToE164(t *testing.T) {
	if got := ToE164("13800000002"); got != "+8613800000002" {
		t.Fatalf("CN ToE164=%q", got)
	}
	if got := ToE164("+1 (555) 123-4567"); got != "+15551234567" {
		t.Fatalf("US ToE164=%q", got)
	}
}

func TestRouteLabel(t *testing.T) {
	if RouteLabel("13800000002") != "aliyun" {
		t.Fatal("expected aliyun")
	}
	if RouteLabel("+447911123456") != "twilio" {
		t.Fatal("expected twilio")
	}
}

func TestNormalizeCNMobile(t *testing.T) {
	if got := NormalizeCNMobile("+86-138-0000-0002"); got != "13800000002" {
		t.Fatalf("got %q", got)
	}
}

func TestAliyunPercentEncode(t *testing.T) {
	if got := aliyunPercentEncode("a b*c~"); got != "a%20b%2Ac~" {
		t.Fatalf("got %q", got)
	}
}

func TestNewFromConfigDev(t *testing.T) {
	s := New("dev")
	if _, ok := s.(DevSender); !ok {
		t.Fatalf("got %T", s)
	}
}

func TestNewFromConfigRouterMissingCreds(t *testing.T) {
	s := New("router")
	err := s.SendOTP(context.Background(), "13800000002", "123456")
	if err == nil {
		t.Fatal("expected configuration error")
	}
}

func TestNewFromConfigTwilioAndAliyun(t *testing.T) {
	tw := NewFromConfig(config.Config{
		SMSProvider:      "twilio",
		TwilioAccountSID: "ACxxx",
		TwilioAuthToken:  "token",
		TwilioFrom:       "+15551234567",
	})
	if _, ok := tw.(*twilioSender); !ok {
		t.Fatalf("twilio got %T", tw)
	}
	al := NewFromConfig(config.Config{
		SMSProvider:           "aliyun",
		AliyunAccessKeyID:     "id",
		AliyunAccessKeySecret: "secret",
		AliyunSignName:        "Qchat",
		AliyunTemplateCode:    "SMS_123",
	})
	if _, ok := al.(*aliyunSender); !ok {
		t.Fatalf("aliyun got %T", al)
	}
	rt := NewFromConfig(config.Config{
		SMSProvider:           "router",
		TwilioAccountSID:      "ACxxx",
		TwilioAuthToken:       "token",
		TwilioFrom:            "+15551234567",
		AliyunAccessKeyID:     "id",
		AliyunAccessKeySecret: "secret",
		AliyunSignName:        "Qchat",
		AliyunTemplateCode:    "SMS_123",
	})
	if _, ok := rt.(*routerSender); !ok {
		t.Fatalf("router got %T", rt)
	}
}
