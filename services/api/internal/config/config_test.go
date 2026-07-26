package config

import "testing"

const testJWTSecret = "abcdefghijklmnopqrstuvwxyz012345"

func TestValidateSecretsProduction(t *testing.T) {
	c := Config{Env: "production", JWTSecret: DefaultJWTSecret, SMSProvider: "aliyun"}
	if err := c.ValidateSecrets(); err == nil {
		t.Fatal("expected error for default JWT in production")
	}
	c.JWTSecret = "short"
	if err := c.ValidateSecrets(); err == nil {
		t.Fatal("expected error for short JWT")
	}
	c.JWTSecret = testJWTSecret
	if err := c.ValidateSecrets(); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	c.Env = "development"
	c.JWTSecret = DefaultJWTSecret
	c.SMSProvider = "dev"
	if err := c.ValidateSecrets(); err != nil {
		t.Fatalf("dev should allow default: %v", err)
	}
}

func TestValidateSecretsRefusesDevSMSInProduction(t *testing.T) {
	for _, provider := range []string{"", "dev"} {
		c := Config{Env: "production", JWTSecret: testJWTSecret, SMSProvider: provider}
		if err := c.ValidateSecrets(); err == nil {
			t.Fatalf("expected error for SMS provider %q in production", provider)
		}
	}
}

func TestLoadDefaultsToDevSMSProvider(t *testing.T) {
	if got := Load().SMSProvider; got != "dev" {
		t.Fatalf("SMSProvider = %q, want dev", got)
	}
}
