package server

import (
	"regexp"
	"strings"
)

var (
	reEdge    = regexp.MustCompile(`(?i)Edg/([\d.]+)`)
	reOpera   = regexp.MustCompile(`(?i)OPR/([\d.]+)`)
	reCriOS   = regexp.MustCompile(`(?i)CriOS/([\d.]+)`)
	reFxiOS   = regexp.MustCompile(`(?i)FxiOS/([\d.]+)`)
	reChrome  = regexp.MustCompile(`(?i)Chrome/([\d.]+)`)
	reFirefox = regexp.MustCompile(`(?i)Firefox/([\d.]+)`)
	reSafari  = regexp.MustCompile(`(?i)Version/([\d.]+).*Safari/`)
	reWin10   = regexp.MustCompile(`Windows NT 10\.0`)
	reAndroid = regexp.MustCompile(`(?i)Android\s+([\d.]+)`)
	reIOS     = regexp.MustCompile(`(?i)OS\s+([\d_]+)`)
	reMac     = regexp.MustCompile(`(?i)Mac OS X\s+([\d_]+)`)
	reUbuntu  = regexp.MustCompile(`(?i)Ubuntu[/ ]?([\d.]+)?`)
)

func weakPlatformLabel(s string) bool {
	s = strings.ToLower(strings.TrimSpace(s))
	return s == "" || s == "web" || s == "desktop" || s == "phone" || s == "mobile" || s == "browser"
}

// displayPlatform prefers a rich client label; falls back to User-Agent parsing.
func displayPlatform(platform, deviceName, deviceType, ua string) string {
	if !weakPlatformLabel(platform) {
		return platform
	}
	if !weakPlatformLabel(deviceName) && !strings.EqualFold(deviceName, "web") {
		// e.g. "Qchat Desktop (Windows 11)" → Windows 11
		if strings.HasPrefix(deviceName, "Qchat Desktop (") && strings.HasSuffix(deviceName, ")") {
			return strings.TrimSuffix(strings.TrimPrefix(deviceName, "Qchat Desktop ("), ")")
		}
		if strings.HasPrefix(deviceName, "Qchat Mobile (") {
			return deviceName
		}
	}
	if label := platformFromUserAgent(ua); label != "" {
		return label
	}
	switch normalizeDevice(deviceType) {
	case "desktop":
		return "Desktop"
	case "phone":
		return "Mobile"
	default:
		return "Web"
	}
}

func platformFromUserAgent(ua string) string {
	ua = strings.TrimSpace(ua)
	if ua == "" {
		return ""
	}
	browser := ""
	if m := reEdge.FindStringSubmatch(ua); len(m) > 1 {
		browser = "Edge " + majorVer(m[1])
	} else if m := reOpera.FindStringSubmatch(ua); len(m) > 1 {
		browser = "Opera " + majorVer(m[1])
	} else if m := reCriOS.FindStringSubmatch(ua); len(m) > 1 {
		browser = "Chrome " + majorVer(m[1])
	} else if m := reFxiOS.FindStringSubmatch(ua); len(m) > 1 {
		browser = "Firefox " + majorVer(m[1])
	} else if m := reChrome.FindStringSubmatch(ua); len(m) > 1 && !strings.Contains(strings.ToLower(ua), "chromium") {
		browser = "Chrome " + majorVer(m[1])
	} else if m := reFirefox.FindStringSubmatch(ua); len(m) > 1 {
		browser = "Firefox " + majorVer(m[1])
	} else if m := reSafari.FindStringSubmatch(ua); len(m) > 1 && !strings.Contains(ua, "Chrome/") {
		browser = "Safari " + majorVer(m[1])
	}
	os := ""
	switch {
	case reWin10.MatchString(ua):
		os = "Windows 10"
	case strings.Contains(ua, "Windows"):
		os = "Windows"
	case reAndroid.MatchString(ua):
		if m := reAndroid.FindStringSubmatch(ua); len(m) > 1 {
			os = "Android " + m[1]
		} else {
			os = "Android"
		}
	case reIOS.MatchString(ua):
		if m := reIOS.FindStringSubmatch(ua); len(m) > 1 {
			os = "iOS " + strings.ReplaceAll(m[1], "_", ".")
		} else {
			os = "iOS"
		}
	case reMac.MatchString(ua):
		if m := reMac.FindStringSubmatch(ua); len(m) > 1 {
			os = "macOS " + strings.ReplaceAll(m[1], "_", ".")
		} else {
			os = "macOS"
		}
	case strings.Contains(strings.ToLower(ua), "ubuntu"):
		if m := reUbuntu.FindStringSubmatch(ua); len(m) > 1 && m[1] != "" {
			os = "Ubuntu " + m[1]
		} else {
			os = "Ubuntu"
		}
	case strings.Contains(ua, "Linux"):
		os = "Linux"
	}
	switch {
	case browser != "" && os != "":
		return browser + " · " + os
	case browser != "":
		return browser
	case os != "":
		return os
	default:
		return ""
	}
}

func majorVer(v string) string {
	if i := strings.IndexByte(v, '.'); i > 0 {
		return v[:i]
	}
	return v
}
