package server_test

import (
	"testing"
)

func TestAdminUserLogSettings(t *testing.T) {
	ts, cleanup := testServer(t)
	defer cleanup()
	base := ts.URL

	memberTok, _, _, _ := registerUser(t, base, "ACME2026")
	owner := platformAdminToken(t, memberTok)

	st, body := getJSON(t, base+"/v1/admin/user-log/settings", owner)
	if st != 200 {
		t.Fatalf("get settings: %d %v", st, body)
	}
	if body["retention_days"] == nil {
		t.Fatalf("missing retention_days: %v", body)
	}

	st, body = patchJSON(t, base+"/v1/admin/user-log/settings", owner, map[string]any{
		"retention_days": 180,
	})
	if st != 200 {
		t.Fatalf("patch settings: %d %v", st, body)
	}
	if int(body["retention_days"].(float64)) != 180 {
		t.Fatalf("expected 180 days: %v", body)
	}

	st, audits := getJSON(t, base+"/v1/admin/audits?limit=50", owner)
	if st != 200 {
		t.Fatalf("audits: %d %v", st, audits)
	}
	rows, _ := audits["audits"].([]any)
	for _, raw := range rows {
		row, _ := raw.(map[string]any)
		action, _ := row["action"].(string)
		if action == "user.login" || action == "messages.inspect" {
			t.Fatalf("user log should exclude login/message actions, got %s", action)
		}
	}
}
