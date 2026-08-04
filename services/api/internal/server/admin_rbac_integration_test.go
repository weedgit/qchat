package server_test

import (
	"context"
	"fmt"
	"os"
	"testing"

	"github.com/qchat/qchat/services/api/internal/db"
)

func TestAdminConsoleRBAC(t *testing.T) {
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

	st, me := getJSON(t, base+"/v1/me", admin)
	if st != 200 {
		t.Fatalf("me: %d %v", st, me)
	}
	phone := fmt.Sprint(me["phone"])

	promote := func(role string) string {
		t.Helper()
		if _, err := pool.Exec(ctx, `UPDATE users SET role=$2 WHERE id=$1`, userID, role); err != nil {
			t.Fatalf("promote %s: %v", role, err)
		}
		cid, code := captcha(t, base)
		st, login := postJSON(t, base+"/v1/auth/login", "", map[string]any{
			"phone": phone, "password": "user12345",
			"captcha_id": cid, "captcha": code,
			"device_type": "web", "remember_me": true,
		})
		if st != 200 {
			t.Fatalf("login as %s: %d %v", role, st, login)
		}
		return fmt.Sprint(login["access_token"])
	}

	// Enterprise admin: inspect and ban OK, cannot issue another enterprise admin.
	tok := promote("enterprise_admin")
	st, _ = getJSON(t, base+"/v1/admin/users?limit=1", tok)
	if st != 200 {
		t.Fatalf("enterprise_admin list users: %d", st)
	}
	st, msgs := getJSON(t, base+"/v1/admin/messages?user_id="+userID+"&reason=admin+inspect+ticket+now", tok)
	if st == 403 {
		t.Fatalf("enterprise_admin should inspect: %v", msgs)
	}
	st, issue := postJSON(t, base+"/v1/admin/users", tok, map[string]any{
		"phone": "13900000998", "password": "user12345", "username": "ea_issue",
		"role": "enterprise_admin",
	})
	if st != 403 {
		t.Fatalf("enterprise_admin issue admin status=%d want 403 %v", st, issue)
	}

	// Members cannot access admin console.
	tok = promote("member")
	st, _ = getJSON(t, base+"/v1/admin/users?limit=1", tok)
	if st != 403 {
		t.Fatalf("member list status=%d want 403", st)
	}
}
