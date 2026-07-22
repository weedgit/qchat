package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

type geoCacheEntry struct {
	label     string
	expiresAt time.Time
}

var geoCache sync.Map // ip -> geoCacheEntry

// lookupEstimatedLocation returns a best-effort city/region/country label for a public IP.
// Uses ip-api.com (no key; rate-limited). Private IPs are not looked up.
func lookupEstimatedLocation(ip string) string {
	ip = strings.TrimSpace(ip)
	if ip == "" || isPrivateOrLocalIP(ip) {
		return ""
	}
	if v, ok := geoCache.Load(ip); ok {
		e := v.(geoCacheEntry)
		if time.Now().Before(e.expiresAt) {
			return e.label
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()
	endpoint := fmt.Sprintf(
		"http://ip-api.com/json/%s?fields=status,message,country,regionName,city",
		url.PathEscape(ip),
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return ""
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return ""
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return ""
	}
	var body struct {
		Status     string `json:"status"`
		Country    string `json:"country"`
		RegionName string `json:"regionName"`
		City       string `json:"city"`
	}
	if json.NewDecoder(res.Body).Decode(&body) != nil || body.Status != "success" {
		geoCache.Store(ip, geoCacheEntry{label: "", expiresAt: time.Now().Add(5 * time.Minute)})
		return ""
	}
	parts := make([]string, 0, 3)
	if c := strings.TrimSpace(body.City); c != "" {
		parts = append(parts, c)
	}
	if r := strings.TrimSpace(body.RegionName); r != "" && r != body.City {
		parts = append(parts, r)
	}
	if c := strings.TrimSpace(body.Country); c != "" {
		parts = append(parts, c)
	}
	label := strings.Join(parts, ", ")
	geoCache.Store(ip, geoCacheEntry{label: label, expiresAt: time.Now().Add(6 * time.Hour)})
	return label
}

func resolveSessionLocation(r *http.Request, ip string) string {
	ip = strings.TrimSpace(ip)
	if ip == "" {
		return "Unknown location"
	}
	if isPrivateOrLocalIP(ip) {
		return "Local network"
	}
	if loc := lookupEstimatedLocation(ip); loc != "" {
		return loc
	}
	if c := strings.TrimSpace(r.Header.Get("CF-IPCountry")); c != "" && c != "XX" && c != "T1" {
		return countryLabel(c)
	}
	if c := strings.TrimSpace(r.Header.Get("X-AppEngine-Country")); c != "" && c != "ZZ" {
		return countryLabel(c)
	}
	return "Unknown location"
}
