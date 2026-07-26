package server_test

import (
	"context"
	"fmt"
	"os"
	"testing"

	"github.com/qchat/qchat/services/api/internal/db"
)

func TestAdminIPAllowlistLoginGate(t *testing.T) {
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
	entID := fmt.Sprint(me["enterprise_id"])

	st, list := getJSON(t, base+"/v1/admin/security/ip-allowlist", admin)
	if st != 200 || list["enforced"] != false {
		t.Fatalf("empty list: %d %v", st, list)
	}

	st, added := postJSON(t, base+"/v1/admin/security/ip-allowlist", admin, map[string]any{
		"cidr": "203.0.113.10", "label": "office",
	})
	if st != 201 {
		t.Fatalf("add: %d %v", st, added)
	}
	entryID := fmt.Sprint(added["id"])
	if fmt.Sprint(added["cidr"]) != "203.0.113.10/32" {
		t.Fatalf("normalized cidr: %v", added)
	}

	st, list = getJSON(t, base+"/v1/admin/security/ip-allowlist", admin)
	if st != 200 || list["enforced"] != true {
		t.Fatalf("enforced list: %d %v", st, list)
	}

	cid, code := captcha(t, base)
	st, denied := postJSONWithIP(t, base+"/v1/auth/login", "", "198.51.100.1", map[string]any{
		"phone": phone, "password": "user12345",
		"captcha_id": cid, "captcha": code,
		"device_type": "web", "remember_me": true,
	})
	if st != 403 || fmt.Sprint(denied["code"]) != "ip_not_allowed" {
		t.Fatalf("denied login: %d %v", st, denied)
	}

	cid2, code2 := captcha(t, base)
	st, okLogin := postJSONWithIP(t, base+"/v1/auth/login", "", "203.0.113.10", map[string]any{
		"phone": phone, "password": "user12345",
		"captcha_id": cid2, "captcha": code2,
		"device_type": "web", "remember_me": true,
	})
	if st != 200 || okLogin["access_token"] == nil {
		t.Fatalf("allowed login: %d %v", st, okLogin)
	}

	fresh := fmt.Sprint(okLogin["access_token"])
	st, del := deleteJSON(t, base+"/v1/admin/security/ip-allowlist/"+entryID, fresh)
	if st != 200 {
		t.Fatalf("delete: %d %v", st, del)
	}

	st, list = getJSON(t, base+"/v1/admin/security/ip-allowlist", fresh)
	if st != 200 || list["enforced"] != false {
		t.Fatalf("after delete: %d %v", st, list)
	}
	_ = entID
}
