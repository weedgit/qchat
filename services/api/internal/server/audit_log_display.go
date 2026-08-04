package server

import (
	"encoding/json"
	"strings"
)

// auditPlatformCategory returns desktop | mobile | web | admin_console for user-log display.
func auditPlatformCategory(action, reason string, meta map[string]any) string {
	if strings.EqualFold(strings.TrimSpace(reason), "admin_console") {
		return "admin_console"
	}
	if cat := platformCategoryFromMeta(meta); cat != "" {
		return cat
	}
	switch action {
	case "invite.rotate", "invite.revoke", "invite.activate",
		"enterprise.create", "enterprise.retention", "retention.run",
		"user_log.retention",
		"backup.settings", "backup.run", "backup.restore",
		"user.create", "user.ban", "user.reset_password", "user.session_revoke",
		"admin.ip_allowlist_add", "admin.ip_allowlist_remove":
		return "admin_console"
	}
	if strings.HasPrefix(action, "admin.") {
		return "admin_console"
	}
	return "web"
}

func platformCategoryFromMeta(meta map[string]any) string {
	if meta == nil {
		return ""
	}
	for _, key := range []string{"platform", "client", "source"} {
		if cat := classifyPlatformToken(strMeta(meta, key)); cat != "" {
			return cat
		}
	}
	if cat := classifyPlatformToken(strMeta(meta, "device")); cat != "" {
		return cat
	}
	if cat := classifyPlatformToken(strMeta(meta, "device_type")); cat != "" {
		return cat
	}
	return ""
}

func classifyPlatformToken(raw string) string {
	s := strings.ToLower(strings.TrimSpace(raw))
	if s == "" {
		return ""
	}
	if strings.Contains(s, "admin") {
		return "admin_console"
	}
	switch s {
	case "admin_console", "admin-console", "admin console":
		return "admin_console"
	case "desktop", "pc", "windows", "macos", "mac", "linux":
		return "desktop"
	case "phone", "mobile", "ios", "android", "huawei", "xiaomi", "oppo", "vivo", "ipad", "tablet":
		return "mobile"
	case "web", "browser":
		return "web"
	}
	if strings.Contains(s, "desktop") || strings.Contains(s, "windows") || strings.Contains(s, "macos") {
		return "desktop"
	}
	if strings.Contains(s, "mobile") || strings.Contains(s, "android") || strings.Contains(s, "iphone") || strings.Contains(s, "ipad") {
		return "mobile"
	}
	if strings.Contains(s, "chrome") || strings.Contains(s, "firefox") || strings.Contains(s, "safari") || strings.Contains(s, "edge") {
		return "web"
	}
	return ""
}

func auditLogLocation(ip string, meta map[string]any) string {
	ip = strings.TrimSpace(ip)
	if meta != nil {
		if loc := strings.TrimSpace(strMeta(meta, "location")); loc != "" {
			return loc
		}
		if region := strings.TrimSpace(strMeta(meta, "ip_region")); region != "" {
			return formatSessionLocation(ip, region)
		}
	}
	if ip == "" {
		return "—"
	}
	if isPrivateOrLocalIP(ip) {
		return formatSessionLocation(ip, "Local network")
	}
	if region := lookupEstimatedLocation(ip); region != "" {
		return formatSessionLocation(ip, region)
	}
	return formatSessionLocation(ip, "")
}

func parseAuditMeta(raw []byte) map[string]any {
	if len(raw) == 0 {
		return nil
	}
	var meta map[string]any
	if json.Unmarshal(raw, &meta) != nil {
		return nil
	}
	return meta
}

func strMeta(meta map[string]any, key string) string {
	if meta == nil {
		return ""
	}
	v, ok := meta[key]
	if !ok || v == nil {
		return ""
	}
	return strings.TrimSpace(fmtAny(v))
}

func fmtAny(v any) string {
	switch t := v.(type) {
	case string:
		return t
	default:
		return strings.TrimSpace(jsonString(t))
	}
}

func jsonString(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	s := strings.TrimSpace(string(b))
	if strings.HasPrefix(s, "\"") && strings.HasSuffix(s, "\"") {
		return strings.Trim(s, "\"")
	}
	return s
}
