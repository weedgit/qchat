package server

import "testing"

func TestAuditPlatformCategory(t *testing.T) {
	if got := auditPlatformCategory("invite.rotate", "", nil); got != "admin_console" {
		t.Fatalf("invite.rotate: got %q", got)
	}
	if got := auditPlatformCategory("group.create", "", map[string]any{"device": "phone"}); got != "mobile" {
		t.Fatalf("phone device: got %q", got)
	}
	if got := auditPlatformCategory("group.create", "", map[string]any{"platform": "desktop"}); got != "desktop" {
		t.Fatalf("desktop platform: got %q", got)
	}
	if got := auditPlatformCategory("group.member_remove", "admin_console", nil); got != "admin_console" {
		t.Fatalf("reason admin_console: got %q", got)
	}
}

func TestAuditLogLocation(t *testing.T) {
	if got := auditLogLocation("", nil); got != "—" {
		t.Fatalf("empty ip: got %q", got)
	}
	if got := auditLogLocation("127.0.0.1", nil); got != "Local network · 127.0.0.1" {
		t.Fatalf("local ip: got %q", got)
	}
	if got := auditLogLocation("8.8.8.8", map[string]any{"ip_region": "California, US"}); got != "Approx. California, US · 8.8.8.8" {
		t.Fatalf("meta region: got %q", got)
	}
}
