package server_test

import (
	"context"
	"fmt"
	"os"
	"testing"

	"github.com/qchat/qchat/services/api/internal/db"
)

func TestAdminLoginAlertsNewDeviceAndIP(t *testing.T) {
	ts, cleanup := testServer(t)
	defer cleanup()
	base := ts.URL

	memberTok, _, userID, _ := registerUser(t, base, "ACME2026")
	admin := adminToken(t, memberTok)

	dsn := os.Getenv("QCHAT_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://qchat:qchat@localhost:5432/qchat?sslmode=disable"
	}
	ctx := context.Background()
	pool, err := db.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	defer pool.Close()
	if _, err := pool.Exec(ctx, `UPDATE users SET role='enterprise_admin' WHERE id=$1`, userID); err != nil {
		t.Fatalf("promote: %v", err)
	}

	st, me := getJSON(t, base+"/v1/me", admin)
	if st != 200 {
		t.Fatalf("me: %d %v", st, me)
	}
	phone := fmt.Sprint(me["phone"])

	cid, code := captcha(t, base)
	st, login := postJSONWithIP(t, base+"/v1/auth/login", "", "203.0.113.50", map[string]any{
		"phone": phone, "password": "user12345",
		"captcha_id": cid, "captcha": code,
		"device_type": "web", "device_id": "alert-device-a",
		"device_name": "admin-web", "platform": "Admin · Web",
		"remember_me": true,
	})
	if st != 200 {
		t.Fatalf("login: %d %v", st, login)
	}
	fresh := fmt.Sprint(login["access_token"])

	st, body := getJSON(t, base+"/v1/admin/security/login-alerts", fresh)
	if st != 200 {
		t.Fatalf("alerts: %d %v", st, body)
	}
	alerts, _ := body["alerts"].([]any)
	if len(alerts) < 1 {
		t.Fatalf("expected at least one alert after new device/IP login: %v", body)
	}
	actions := map[string]bool{}
	for _, item := range alerts {
		m, _ := item.(map[string]any)
		actions[fmt.Sprint(m["action"])] = true
	}
	if !actions["admin.login_new_device"] && !actions["admin.login_new_ip"] {
		t.Fatalf("missing new device/ip actions: %v", actions)
	}

	before := len(alerts)
	cid2, code2 := captcha(t, base)
	st, login2 := postJSONWithIP(t, base+"/v1/auth/login", "", "203.0.113.50", map[string]any{
		"phone": phone, "password": "user12345",
		"captcha_id": cid2, "captcha": code2,
		"device_type": "web", "device_id": "alert-device-a",
		"remember_me": true,
	})
	if st != 200 {
		t.Fatalf("second login: %d %v", st, login2)
	}
	fresh2 := fmt.Sprint(login2["access_token"])
	st, body = getJSON(t, base+"/v1/admin/security/login-alerts", fresh2)
	if st != 200 {
		t.Fatalf("alerts2: %d %v", st, body)
	}
	alerts, _ = body["alerts"].([]any)
	if len(alerts) != before {
		t.Fatalf("repeat login should not add alerts: before=%d after=%d", before, len(alerts))
	}
}
