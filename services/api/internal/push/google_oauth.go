package push

import (
	"context"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type googleSA struct {
	ClientEmail string `json:"client_email"`
	PrivateKey  string `json:"private_key"`
	TokenURI    string `json:"token_uri"`
}

func googleServiceAccountToken(ctx context.Context, credJSON []byte, scope string) (string, time.Time, error) {
	var sa googleSA
	if err := json.Unmarshal(credJSON, &sa); err != nil {
		return "", time.Time{}, fmt.Errorf("parse service account: %w", err)
	}
	if sa.ClientEmail == "" || sa.PrivateKey == "" {
		return "", time.Time{}, fmt.Errorf("service account missing client_email or private_key")
	}
	tokenURI := sa.TokenURI
	if tokenURI == "" {
		tokenURI = "https://oauth2.googleapis.com/token"
	}
	block, _ := pem.Decode([]byte(sa.PrivateKey))
	if block == nil {
		return "", time.Time{}, fmt.Errorf("service account private_key: no PEM")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		// Some keys are PKCS1.
		if k, err2 := x509.ParsePKCS1PrivateKey(block.Bytes); err2 == nil {
			parsed = k
		} else {
			return "", time.Time{}, fmt.Errorf("parse private key: %w", err)
		}
	}
	rsaKey, ok := parsed.(*rsa.PrivateKey)
	if !ok {
		return "", time.Time{}, fmt.Errorf("service account key must be RSA")
	}
	now := time.Now()
	claims := jwt.MapClaims{
		"iss":   sa.ClientEmail,
		"scope": scope,
		"aud":   tokenURI,
		"iat":   now.Unix(),
		"exp":   now.Add(55 * time.Minute).Unix(),
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodRS256, claims).SignedString(rsaKey)
	if err != nil {
		return "", time.Time{}, err
	}
	form := url.Values{}
	form.Set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer")
	form.Set("assertion", signed)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenURI, strings.NewReader(form.Encode()))
	if err != nil {
		return "", time.Time{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	client := &http.Client{Timeout: 12 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", time.Time{}, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 400 {
		return "", time.Time{}, fmt.Errorf("google token status %d: %s", resp.StatusCode, truncate(string(raw), 200))
	}
	var out struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int64  `json:"expires_in"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", time.Time{}, err
	}
	if out.AccessToken == "" {
		return "", time.Time{}, fmt.Errorf("google token empty")
	}
	exp := now.Add(time.Duration(out.ExpiresIn) * time.Second)
	if out.ExpiresIn <= 0 {
		exp = now.Add(50 * time.Minute)
	}
	return out.AccessToken, exp, nil
}
