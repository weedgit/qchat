package config

import "testing"

const testJWTSecret = "abcdefghijklmnopqrstuvwxyz012345"
const testLiveKitSecret = "production-livekit-secret-32chars!!"

func prodBase() Config {
	return Config{
		Env:              "production",
		JWTSecret:        testJWTSecret,
		LiveKitURL:       "wss://chat.example.com:7443",
		LiveKitAPIKey:    "prodkey",
		LiveKitAPISecret: testLiveKitSecret,
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
	c.LiveKitAPIKey = DefaultLiveKitAPIKey
	c.LiveKitAPISecret = DefaultLiveKitAPISecret
	if err := c.ValidateSecrets(); err != nil {
		t.Fatalf("dev should allow default: %v", err)
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
