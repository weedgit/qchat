package push

import (
	"context"
	"log"
	"strings"
)

// Device is a stored push endpoint for one platform.
type Device struct {
	ID       string
	Platform string
	Token    string
}

// EnabledAdapters lists send backends that are configured right now.
// OEM vendors (huawei/xiaomi/oppo/vivo) are accepted on register but not sent yet.
func (c Config) EnabledAdapters() []string {
	out := make([]string, 0, 4)
	if c.WebEnabled() {
		out = append(out, "web-push")
	}
	if c.ExpoEnabled() {
		out = append(out, "expo")
	}
	if c.FCMEnabled() {
		out = append(out, "fcm")
	}
	if c.APNsEnabled() {
		out = append(out, "apns")
	}
	return out
}

// AnyEnabled is true when at least one delivery backend can send.
func (c Config) AnyEnabled() bool {
	return c.WebEnabled() || c.ExpoEnabled() || c.FCMEnabled() || c.APNsEnabled()
}

// Dispatch sends p to one device. Returns HTTP-like status for stale cleanup (404/410).
func Dispatch(ctx context.Context, cfg Config, d Device, p WebPayload) (int, error) {
	platform := strings.ToLower(strings.TrimSpace(d.Platform))
	token := strings.TrimSpace(d.Token)
	if token == "" {
		return 0, nil
	}

	switch platform {
	case "web":
		return SendWeb(ctx, cfg, token, p)
	case "android", "ios":
		if looksLikeExpoPushToken(token) {
			return SendExpo(ctx, cfg, token, p)
		}
		if platform == "android" {
			return SendFCM(ctx, cfg, token, p)
		}
		return SendAPNs(ctx, cfg, token, p)
	case "huawei", "xiaomi", "oppo", "vivo":
		// OEM channels deferred — tokens may be stored but are not delivered yet.
		log.Printf("push: skip oem platform=%s (not implemented)", platform)
		return 0, nil
	default:
		log.Printf("push: skip unknown platform=%s", platform)
		return 0, nil
	}
}

func looksLikeExpoPushToken(token string) bool {
	return strings.HasPrefix(token, "ExponentPushToken[") ||
		strings.HasPrefix(token, "ExpoPushToken[")
}
