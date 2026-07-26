package server

import (
	"fmt"
	"net"
	"strings"
)

// normalizeCIDR accepts a single IP or CIDR and returns a canonical CIDR string.
func normalizeCIDR(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", fmt.Errorf("cidr required")
	}
	if strings.Contains(raw, "/") {
		ip, network, err := net.ParseCIDR(raw)
		if err != nil {
			return "", fmt.Errorf("invalid cidr")
		}
		if ip == nil || network == nil {
			return "", fmt.Errorf("invalid cidr")
		}
		// Prefer the network address form (e.g. 10.0.0.5/24 → 10.0.0.0/24).
		ones, bits := network.Mask.Size()
		if ones < 0 || bits <= 0 {
			return "", fmt.Errorf("invalid cidr")
		}
		return fmt.Sprintf("%s/%d", network.IP.String(), ones), nil
	}
	ip := net.ParseIP(raw)
	if ip == nil {
		return "", fmt.Errorf("invalid ip or cidr")
	}
	if ip.To4() != nil {
		return ip.To4().String() + "/32", nil
	}
	return ip.String() + "/128", nil
}

func parseCIDR(cidr string) (*net.IPNet, error) {
	normalized, err := normalizeCIDR(cidr)
	if err != nil {
		return nil, err
	}
	_, network, err := net.ParseCIDR(normalized)
	if err != nil {
		return nil, fmt.Errorf("invalid cidr")
	}
	return network, nil
}

func ipInCIDR(ipStr, cidr string) bool {
	ip := net.ParseIP(strings.TrimSpace(ipStr))
	if ip == nil {
		return false
	}
	network, err := parseCIDR(cidr)
	if err != nil {
		return false
	}
	return network.Contains(ip)
}

func ipAllowedByList(ipStr string, cidrs []string) bool {
	if len(cidrs) == 0 {
		return true
	}
	for _, c := range cidrs {
		if ipInCIDR(ipStr, c) {
			return true
		}
	}
	return false
}
