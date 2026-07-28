package config

import "testing"

const testJWTSecret = "abcdefghijklmnopqrstuvwxyz012345"
const testLiveKitSecret = "production-livekit-secret-32chars!!"

func prodBase() Config {
	return Config{
		Env:                   "production",
		JWTSecret:             testJWTSecret,
		SMSProvider:           "aliyun",
		AliyunAccessKeyID:     "test-ak",
		AliyunAccessKeySecret: "test-sk",
		AliyunSignName:        "Qchat",
		AliyunTemplateCode:    "SMS_TEST",
		LiveKitURL:            "wss://chat.example.com:7443",
		LiveKitAPIKey:         "prodkey",
		LiveKitAPISecret:      testLiveKitSecret,
	}
}

func TestValidateSecretsProduction(t *testing.T) {
	c := prodBase()
	c.JWTSecret = DefaultJWTSecret
	if err := c.ValidateSecrets(); err == nil {
		t.Fatal("expected error for default JWT in production")
	}
	c.JWTSecret = "short"
	if err := c.ValidateSecrets(); err == nil {
		t.Fatal("expected error for short JWT")
	}
	c = prodBase()
	if err := c.ValidateSecrets(); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	c.Env = "development"
	c.JWTSecret = DefaultJWTSecret
	c.SMSProvider = "dev"
	c.LiveKitAPIKey = DefaultLiveKitAPIKey
	c.LiveKitAPISecret = DefaultLiveKitAPISecret
	if err := c.ValidateSecrets(); err != nil {
		t.Fatalf("dev should allow default: %v", err)
	}
}

func TestValidateSecretsRefusesDevSMSInProduction(t *testing.T) {
	for _, provider := range []string{"", "dev"} {
		c := prodBase()
		c.SMSProvider = provider
		if err := c.ValidateSecrets(); err == nil {
			t.Fatalf("expected error for SMS provider %q in production", provider)
		}
	}
}

func TestValidateSecretsRequiresSMSCredentials(t *testing.T) {
	c := prodBase()
	c.SMSProvider = "twilio"
	c.TwilioAccountSID = ""
	if err := c.ValidateSecrets(); err == nil {
		t.Fatal("expected error for missing Twilio creds")
	}
	c = prodBase()
	c.SMSProvider = "twilio"
	c.TwilioAccountSID = "ACxxx"
	c.TwilioAuthToken = "tok"
	c.TwilioFrom = "+15551234567"
	if err := c.ValidateSecrets(); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	c = prodBase()
	c.AliyunSignName = ""
	if err := c.ValidateSecrets(); err == nil {
		t.Fatal("expected error for missing Aliyun sign name")
	}
	c = prodBase()
	c.SMSProvider = "router"
	if err := c.ValidateSecrets(); err == nil {
		t.Fatal("expected error for router without Twilio")
	}
	c.TwilioAccountSID = "ACxxx"
	c.TwilioAuthToken = "tok"
	c.TwilioFrom = "+15551234567"
	if err := c.ValidateSecrets(); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	c.SMSProvider = "nexmo"
	if err := c.ValidateSecrets(); err == nil {
		t.Fatal("expected error for unknown provider")
	}
}

func TestValidateSecretsRefusesDefaultLiveKitInProduction(t *testing.T) {
	c := prodBase()
	c.LiveKitAPIKey = DefaultLiveKitAPIKey
	if err := c.ValidateSecrets(); err == nil {
		t.Fatal("expected error for default LiveKit API key")
	}
	c = prodBase()
	c.LiveKitAPISecret = DefaultLiveKitAPISecret
	if err := c.ValidateSecrets(); err == nil {
		t.Fatal("expected error for default LiveKit API secret")
	}
	c = prodBase()
	c.LiveKitAPISecret = "too-short"
	if err := c.ValidateSecrets(); err == nil {
		t.Fatal("expected error for short LiveKit API secret")
	}
	c = prodBase()
	c.LiveKitURL = ""
	if err := c.ValidateSecrets(); err == nil {
		t.Fatal("expected error for empty LiveKit URL")
	}
}

func TestLoadDefaultsToDevSMSProvider(t *testing.T) {
	if got := Load().SMSProvider; got != "dev" {
		t.Fatalf("SMSProvider = %q, want dev", got)
	}
}
