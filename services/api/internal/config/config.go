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
const DefaultLiveKitAPIKey = "devkey"
const DefaultLiveKitAPISecret = "secret-that-is-at-least-32-characters-long"

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
	// Object storage credentials (MinIO / S3). Defaults match docker-compose minio.
	ObjectStorageAccessKey string
	ObjectStorageSecretKey string
	// DataDir holds local uploads (…/uploads). Override with QCHAT_DATA_DIR.
	DataDir     string
	MigrateOnly bool
	Env         string
	// LiveKit SFU (Phase 6 voice/video). Defaults match deploy/livekit.yaml.
	LiveKitURL       string
	LiveKitAPIKey    string
	LiveKitAPISecret string
	// Web Push VAPID (dev defaults; override in production).
	VAPIDPublic  string
	VAPIDPrivate string
	VAPIDSubject string
	// Mobile push — Getui is primary for China mainland; Expo/FCM/APNs optional fallback.
	ExpoPushEnabled    string
	ExpoAccessToken    string
	FCMProjectID       string
	FCMCredentialsJSON string
	APNsKeyID          string
	APNsTeamID         string
	APNsBundleID       string
	APNsKeyPath        string
	APNsProduction     string
	GetuiEnabled       string
	GetuiAppID         string
	GetuiAppKey        string
	GetuiMasterSecret  string
	// GiphyAPIKey powers composer GIF search via GET /v1/gifs. Empty disables
	// the feature with a clear API error (Tenor third-party API is shut down).
	GiphyAPIKey string
	// BackupDir is where deploy/backup.sh writes status.json (admin DR status).
	BackupDir string
}

func Load() Config {
	return Config{
		HTTPAddr:               getenv("QCHAT_HTTP_ADDR", ":8080"),
		DatabaseURL:            getenv("QCHAT_DATABASE_URL", "postgres://qchat:qchat@localhost:5432/qchat?sslmode=disable"),
		RedisURL:               getenv("QCHAT_REDIS_URL", "redis://localhost:6379/0"),
		JWTSecret:              getenv("QCHAT_JWT_SECRET", DefaultJWTSecret),
		AccessTTL:              durationEnv("QCHAT_ACCESS_TTL", 15*time.Minute),
		RefreshTTL:             durationEnv("QCHAT_REFRESH_TTL", 60*24*time.Hour),
		CORSOrigin:             getenv("QCHAT_CORS_ORIGIN", "*"),
		ObjectStorageURL:       getenv("QCHAT_OBJECT_STORAGE_URL", "http://localhost:9000"),
		Bucket:                 getenv("QCHAT_BUCKET", "qchat"),
		ObjectStorageAccessKey: getenv("QCHAT_OBJECT_STORAGE_ACCESS_KEY", "qchatminio"),
		ObjectStorageSecretKey: getenv("QCHAT_OBJECT_STORAGE_SECRET_KEY", "qchatminio123"),
		DataDir:                resolveDataDir(),
		Env:                    strings.ToLower(getenv("QCHAT_ENV", "development")),
		LiveKitURL:             getenv("LIVEKIT_URL", "ws://localhost:7880"),
		LiveKitAPIKey:          getenv("LIVEKIT_API_KEY", DefaultLiveKitAPIKey),
		LiveKitAPISecret:       getenv("LIVEKIT_API_SECRET", DefaultLiveKitAPISecret),
		VAPIDPublic:            getenv("QCHAT_VAPID_PUBLIC", "BFdXB2ANYUTz51uvhyiHY690_q7gwTQugmCht6XglXgTLyoubrPvnpQVk4Jac5cP_zVayT88l0gTgnCt1gK5cfA"),
		VAPIDPrivate:           getenv("QCHAT_VAPID_PRIVATE", "bUnBIxgamtcANH9nAryWvxT0v8s4iosetHMSeOmcB7g"),
		VAPIDSubject:           getenv("QCHAT_VAPID_SUBJECT", "mailto:admin@qchat.local"),
		ExpoPushEnabled:        getenv("QCHAT_EXPO_PUSH_ENABLED", "true"),
		ExpoAccessToken:        strings.TrimSpace(getenv("QCHAT_EXPO_ACCESS_TOKEN", "")),
		FCMProjectID:           strings.TrimSpace(getenv("QCHAT_FCM_PROJECT_ID", "")),
		FCMCredentialsJSON:     strings.TrimSpace(getenv("QCHAT_FCM_CREDENTIALS_JSON", "")),
		APNsKeyID:              strings.TrimSpace(getenv("QCHAT_APNS_KEY_ID", "")),
		APNsTeamID:             strings.TrimSpace(getenv("QCHAT_APNS_TEAM_ID", "")),
		APNsBundleID:           strings.TrimSpace(getenv("QCHAT_APNS_BUNDLE_ID", "")),
		APNsKeyPath:            strings.TrimSpace(getenv("QCHAT_APNS_KEY_PATH", "")),
		APNsProduction:         getenv("QCHAT_APNS_PRODUCTION", "1"),
		GetuiEnabled:           strings.TrimSpace(getenv("QCHAT_GETUI_ENABLED", "")),
		GetuiAppID:             strings.TrimSpace(getenv("QCHAT_GETUI_APP_ID", "")),
		GetuiAppKey:            strings.TrimSpace(getenv("QCHAT_GETUI_APP_KEY", "")),
		GetuiMasterSecret:      strings.TrimSpace(getenv("QCHAT_GETUI_MASTER_SECRET", "")),
		GiphyAPIKey:            strings.TrimSpace(getenv("QCHAT_GIPHY_API_KEY", "")),
		BackupDir:              resolveBackupDir(),
	}
}

// ValidateSecrets refuses weak JWT / LiveKit defaults when QCHAT_ENV=production.
func (c Config) ValidateSecrets() error {
	if c.Env != "production" {
		return nil
	}
	if c.JWTSecret == "" || c.JWTSecret == DefaultJWTSecret || len(c.JWTSecret) < 32 {
		return fmt.Errorf("QCHAT_JWT_SECRET must be a unique secret (≥32 chars); run deploy/rotate-jwt-secret.sh")
	}
	if c.LiveKitAPIKey == "" || c.LiveKitAPIKey == DefaultLiveKitAPIKey {
		return fmt.Errorf("LIVEKIT_API_KEY must not use the default %q in production; set a unique key in deploy/qchat-api.env", DefaultLiveKitAPIKey)
	}
	if c.LiveKitAPISecret == "" || c.LiveKitAPISecret == DefaultLiveKitAPISecret || len(c.LiveKitAPISecret) < 32 {
		return fmt.Errorf("LIVEKIT_API_SECRET must be a unique secret (≥32 chars) in production; re-run deploy/render-media-config.sh with LIVEKIT_API_SECRET set")
	}
	if strings.TrimSpace(c.LiveKitURL) == "" {
		return fmt.Errorf("LIVEKIT_URL is required in production (run deploy/render-media-config.sh)")
	}
	return nil
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// resolveBackupDir locates deploy/backup.sh output (status.json / latest/).
func resolveBackupDir() string {
	if v := strings.TrimSpace(os.Getenv("QCHAT_BACKUP_DIR")); v != "" {
		return v
	}
	candidates := []string{
		"backups",
		filepath.Join("..", "..", "backups"),
		filepath.Join("..", "backups"),
		"/root/qchat/backups",
	}
	for _, c := range candidates {
		if st, err := os.Stat(c); err == nil && st.IsDir() {
			return c
		}
	}
	return "backups"
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
