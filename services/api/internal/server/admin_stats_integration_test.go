package server_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestAdminStatsTrends(t *testing.T) {
	ts, cleanup := testServer(t)
	defer cleanup()
	memberTok, _, _, _ := registerUser(t, ts.URL, "ACME2026")
	owner := platformAdminToken(t, memberTok)
	st, body := getJSON(t, ts.URL+"/v1/admin/stats/trends?days=30", owner)
	if st != 200 {
		t.Fatalf("status %d body %v", st, body)
	}
	if body["users"] == nil || body["messages"] == nil {
		t.Fatalf("missing series: %v", body)
	}
}

func TestPlatformAdminOverviewCountsAllEnterprises(t *testing.T) {
	ts, cleanup := testServer(t)
	defer cleanup()
	base := ts.URL

	memberTok, _, _, _ := registerUser(t, base, "ACME2026")
	owner := platformAdminToken(t, memberTok)

	st, acmeUsers := getJSON(t, base+"/v1/admin/users?limit=1", owner)
	if st != 200 {
		t.Fatalf("acme users: %d %v", st, acmeUsers)
	}
	acmeTotal, _ := acmeUsers["total"].(float64)

	phone := fmt.Sprintf("138%08d", time.Now().UnixNano()%100000000)
	uname := "eadm" + uuid.NewString()[:6]
	st, entBody := postJSON(t, base+"/v1/admin/enterprises", owner, map[string]any{
		"name":           "Overview Test Co",
		"admin_phone":    phone,
		"admin_password": "AdminPass1",
		"admin_username": uname,
	})
	if st != 201 {
		t.Fatalf("create enterprise: %d %v", st, entBody)
	}

	st, allUsers := getJSON(t, base+"/v1/admin/users?limit=1", owner)
	if st != 200 {
		t.Fatalf("all users: %d %v", st, allUsers)
	}
	allTotal, _ := allUsers["total"].(float64)
	if allTotal <= acmeTotal {
		t.Fatalf("platform admin user total %v should exceed single-enterprise %v", allTotal, acmeTotal)
	}

	st, enterprises := getJSON(t, base+"/v1/admin/enterprises?limit=1", owner)
	if st != 200 {
		t.Fatalf("enterprises: %d %v", st, enterprises)
	}
	entTotal, _ := enterprises["total"].(float64)
	if entTotal < 2 {
		t.Fatalf("expected at least 2 enterprises, got %v", entTotal)
	}
}
