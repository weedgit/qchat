package config

import "testing"

func TestValidateSecretsProduction(t *testing.T) {
	c := Config{Env: "production", JWTSecret: DefaultJWTSecret}
	if err := c.ValidateSecrets(); err == nil {
		t.Fatal("expected error for default JWT in production")
	}
	c.JWTSecret = "short"
	if err := c.ValidateSecrets(); err == nil {
		t.Fatal("expected error for short JWT")
	}
	c.JWTSecret = "abcdefghijklmnopqrstuvwxyz012345"
	if err := c.ValidateSecrets(); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	c.Env = "development"
	c.JWTSecret = DefaultJWTSecret
	if err := c.ValidateSecrets(); err != nil {
		t.Fatalf("dev should allow default: %v", err)
	}
}
