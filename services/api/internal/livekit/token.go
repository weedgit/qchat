package livekit

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// TokenConfig holds LiveKit API credentials used to mint participant JWTs.
type TokenConfig struct {
	URL       string // browser-facing ws URL, e.g. ws://localhost:7880
	APIKey    string
	APISecret string
}

// Enabled reports whether LiveKit credentials are configured.
func (c TokenConfig) Enabled() bool {
	return c.URL != "" && c.APIKey != "" && c.APISecret != ""
}

// videoGrant mirrors LiveKit's VideoGrant claim set for room join.
type videoGrant struct {
	RoomJoin      bool   `json:"roomJoin"`
	Room          string `json:"room"`
	CanPublish    bool   `json:"canPublish"`
	CanSubscribe  bool   `json:"canSubscribe"`
	CanPublishData bool  `json:"canPublishData"`
}

type accessClaims struct {
	jwt.RegisteredClaims
	Name  string     `json:"name,omitempty"`
	Video videoGrant `json:"video"`
}

// MintJoinToken creates a LiveKit access token for joining a room (publish/subscribe).
// Uses HS256 with API secret — same shape as livekit/protocol/auth without that dependency.
func MintJoinToken(cfg TokenConfig, room, identity, name string, ttl time.Duration) (string, error) {
	if !cfg.Enabled() {
		return "", fmt.Errorf("livekit not configured")
	}
	if ttl <= 0 {
		ttl = time.Hour
	}
	now := time.Now()
	claims := accessClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    cfg.APIKey,
			Subject:   identity,
			NotBefore: jwt.NewNumericDate(now.Add(-time.Minute)),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		},
		Name: name,
		Video: videoGrant{
			RoomJoin:       true,
			Room:           room,
			CanPublish:     true,
			CanSubscribe:   true,
			CanPublishData: true,
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return tok.SignedString([]byte(cfg.APISecret))
}
