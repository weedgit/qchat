package server_test

import (
	"testing"
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
