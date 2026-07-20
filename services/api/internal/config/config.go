package config

import (
	"os"
	"strconv"
	"time"
)

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
	MigrateOnly      bool
	// LiveKit SFU (Phase 6 voice/video). Defaults match deploy/livekit.yaml.
	LiveKitURL       string
	LiveKitAPIKey    string
	LiveKitAPISecret string
	// Web Push VAPID (dev defaults; override in production).
	VAPIDPublic  string
	VAPIDPrivate string
	VAPIDSubject string
}

func Load() Config {
	return Config{
		HTTPAddr:         getenv("QCHAT_HTTP_ADDR", ":8080"),
		DatabaseURL:      getenv("QCHAT_DATABASE_URL", "postgres://qchat:qchat@localhost:5432/qchat?sslmode=disable"),
		RedisURL:         getenv("QCHAT_REDIS_URL", "redis://localhost:6379/0"),
		JWTSecret:        getenv("QCHAT_JWT_SECRET", "dev-qchat-secret-change-me"),
		AccessTTL:        durationEnv("QCHAT_ACCESS_TTL", 15*time.Minute),
		RefreshTTL:       durationEnv("QCHAT_REFRESH_TTL", 60*24*time.Hour),
		CORSOrigin:       getenv("QCHAT_CORS_ORIGIN", "http://localhost:3000"),
		ObjectStorageURL: getenv("QCHAT_OBJECT_STORAGE_URL", "http://localhost:9000"),
		Bucket:           getenv("QCHAT_BUCKET", "qchat"),
		LiveKitURL:       getenv("LIVEKIT_URL", "ws://localhost:7880"),
		LiveKitAPIKey:    getenv("LIVEKIT_API_KEY", "devkey"),
		LiveKitAPISecret: getenv("LIVEKIT_API_SECRET", "secret-that-is-at-least-32-characters-long"),
		VAPIDPublic:      getenv("QCHAT_VAPID_PUBLIC", "BFdXB2ANYUTz51uvhyiHY690_q7gwTQugmCht6XglXgTLyoubrPvnpQVk4Jac5cP_zVayT88l0gTgnCt1gK5cfA"),
		VAPIDPrivate:     getenv("QCHAT_VAPID_PRIVATE", "bUnBIxgamtcANH9nAryWvxT0v8s4iosetHMSeOmcB7g"),
		VAPIDSubject:     getenv("QCHAT_VAPID_SUBJECT", "mailto:admin@qchat.local"),
	}
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
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
