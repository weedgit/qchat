package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const DefaultJWTSecret = "dev-qchat-secret-change-me"

type Config struct {
	HTTPAddr         string
	DatabaseURL      string
	RedisURL         string
	JWTSecret        string
	AccessTTL        time.Duration
	RefreshTTL       time.Duration
	CORSOrigin       string
	ObjectStorageURL string
	Bucket           string
	// DataDir holds local uploads (…/uploads). Override with QCHAT_DATA_DIR.
	DataDir          string
	MigrateOnly      bool
	Env              string
	// LiveKit SFU (Phase 6 voice/video). Defaults match deploy/livekit.yaml.
	LiveKitURL       string
	LiveKitAPIKey    string
	LiveKitAPISecret string
	// Web Push VAPID (dev defaults; override in production).
	VAPIDPublic  string
	VAPIDPrivate string
	VAPIDSubject string
	// SMSProvider selects the verification-code gateway. "dev" only logs codes
	// locally and is refused in production.
	SMSProvider string
}

func Load() Config {
	return Config{
		HTTPAddr:         getenv("QCHAT_HTTP_ADDR", ":8080"),
		DatabaseURL:      getenv("QCHAT_DATABASE_URL", "postgres://qchat:qchat@localhost:5432/qchat?sslmode=disable"),
		RedisURL:         getenv("QCHAT_REDIS_URL", "redis://localhost:6379/0"),
		JWTSecret:        getenv("QCHAT_JWT_SECRET", DefaultJWTSecret),
		AccessTTL:        durationEnv("QCHAT_ACCESS_TTL", 15*time.Minute),
		RefreshTTL:       durationEnv("QCHAT_REFRESH_TTL", 60*24*time.Hour),
		CORSOrigin:       getenv("QCHAT_CORS_ORIGIN", "*"),
		ObjectStorageURL: getenv("QCHAT_OBJECT_STORAGE_URL", "http://localhost:9000"),
		Bucket:           getenv("QCHAT_BUCKET", "qchat"),
		DataDir:          resolveDataDir(),
		Env:              strings.ToLower(getenv("QCHAT_ENV", "development")),
		LiveKitURL:       getenv("LIVEKIT_URL", "ws://localhost:7880"),
		LiveKitAPIKey:    getenv("LIVEKIT_API_KEY", "devkey"),
		LiveKitAPISecret: getenv("LIVEKIT_API_SECRET", "secret-that-is-at-least-32-characters-long"),
		VAPIDPublic:      getenv("QCHAT_VAPID_PUBLIC", "BFdXB2ANYUTz51uvhyiHY690_q7gwTQugmCht6XglXgTLyoubrPvnpQVk4Jac5cP_zVayT88l0gTgnCt1gK5cfA"),
		VAPIDPrivate:     getenv("QCHAT_VAPID_PRIVATE", "bUnBIxgamtcANH9nAryWvxT0v8s4iosetHMSeOmcB7g"),
		VAPIDSubject:     getenv("QCHAT_VAPID_SUBJECT", "mailto:admin@qchat.local"),
		SMSProvider:      strings.ToLower(getenv("QCHAT_SMS_PROVIDER", "dev")),
	}
}

// ValidateSecrets refuses weak JWT defaults when QCHAT_ENV=production
// (ServiceSettings.EnableDeveloper / production checks).
func (c Config) ValidateSecrets() error {
	if c.Env != "production" {
		return nil
	}
	if c.JWTSecret == "" || c.JWTSecret == DefaultJWTSecret || len(c.JWTSecret) < 32 {
		return fmt.Errorf("QCHAT_JWT_SECRET must be a unique secret (≥32 chars); run deploy/rotate-jwt-secret.sh")
	}
	if c.SMSProvider == "" || c.SMSProvider == "dev" {
		return fmt.Errorf("QCHAT_SMS_PROVIDER must name a real gateway in production; %q only logs codes locally", c.SMSProvider)
	}
	return nil
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// resolveDataDir picks the local upload root (…/uploads). Prefer an existing
// tree so API cwd may be either services/api or the monorepo root.
func resolveDataDir() string {
	if v := os.Getenv("QCHAT_DATA_DIR"); v != "" {
		return v
	}
	candidates := []string{
		"data",
		"services/api/data",
		filepath.Join("..", "data"),
	}
	for _, c := range candidates {
		if st, err := os.Stat(filepath.Join(c, "uploads")); err == nil && st.IsDir() {
			return c
		}
	}
	return "data"
}

func durationEnv(k string, def time.Duration) time.Duration {
	if v := os.Getenv(k); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
		if n, err := strconv.Atoi(v); err == nil {
			return time.Duration(n) * time.Second
		}
	}
	return def
}
