package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math/big"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type Claims struct {
	UserID       string `json:"uid"`
	EnterpriseID string `json:"eid"`
	Role         string `json:"role"`
	SessionID    string `json:"sid"`
	DeviceType   string `json:"dtype"`
	DeviceID     string `json:"did,omitempty"`
	jwt.RegisteredClaims
}

func IssueAccess(secret string, ttl time.Duration, userID, enterpriseID, role, sessionID, deviceType, deviceID string) (string, error) {
	claims := Claims{
		UserID:       userID,
		EnterpriseID: enterpriseID,
		Role:         role,
		SessionID:    sessionID,
		DeviceType:   deviceType,
		DeviceID:     deviceID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(ttl)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ID:        uuid.NewString(),
		},
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return t.SignedString([]byte(secret))
}

func ParseAccess(secret, token string) (*Claims, error) {
	t, err := jwt.ParseWithClaims(token, &Claims{}, func(t *jwt.Token) (any, error) {
		if t.Method != jwt.SigningMethodHS256 {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}
	c, ok := t.Claims.(*Claims)
	if !ok || !t.Valid {
		return nil, fmt.Errorf("invalid token")
	}
	return c, nil
}

func NewRefreshToken() (raw string, hash string, err error) {
	b := make([]byte, 32)
	if _, err = rand.Read(b); err != nil {
		return "", "", err
	}
	raw = hex.EncodeToString(b)
	sum := sha256.Sum256([]byte(raw))
	return raw, hex.EncodeToString(sum[:]), nil
}

func HashRefresh(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// NewNumericCode returns a cryptographically random decimal verification code.
// crypto/rand.Int is used rather than modulo over a random byte so every digit
// is uniformly distributed.
func NewNumericCode(digits int) (string, error) {
	if digits <= 0 {
		return "", fmt.Errorf("digits must be positive")
	}
	out := make([]byte, digits)
	for i := range out {
		n, err := rand.Int(rand.Reader, big.NewInt(10))
		if err != nil {
			return "", err
		}
		out[i] = byte('0' + n.Int64())
	}
	return string(out), nil
}

func NewCaptchaCode() string {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	b := make([]byte, 5)
	_, _ = rand.Read(b)
	out := make([]byte, 5)
	for i := range out {
		out[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(out)
}
