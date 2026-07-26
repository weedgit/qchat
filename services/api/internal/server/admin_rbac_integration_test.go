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

	// Compliance: inspect OK, ban forbidden.
	tok := promote("compliance")
	st, _ = getJSON(t, base+"/v1/admin/users?limit=1", tok)
	if st != 200 {
		t.Fatalf("compliance list users: %d", st)
	}
	st, msgs := getJSON(t, base+"/v1/admin/messages?user_id="+userID+"&reason=compliance+ticket+inspect+now", tok)
	if st == 403 {
		t.Fatalf("compliance should inspect: %v", msgs)
	}
	st, ban := postJSON(t, base+"/v1/admin/users/"+userID+"/ban", tok, map[string]any{
		"banned": true, "reason": "should not be allowed here",
	})
	if st != 403 {
		t.Fatalf("compliance ban status=%d want 403 %v", st, ban)
	}

	// Support: reset password OK, inspect forbidden.
	tok = promote("support")
	st, inspect := getJSON(t, base+"/v1/admin/messages?user_id="+userID+"&reason=support+trying+to+read+chat", tok)
	if st != 403 {
		t.Fatalf("support inspect status=%d want 403 %v", st, inspect)
	}
	peerTok, _, peerID, _ := registerUser(t, base, "ACME2026")
	_ = peerTok
	st, reset := postJSON(t, base+"/v1/admin/users/"+peerID+"/reset-password", tok, map[string]any{
		"password": "newpass123", "reason": "support ticket password reset",
	})
	if st != 200 {
		t.Fatalf("support reset: %d %v", st, reset)
	}

	// Read-only: list OK, create forbidden.
	tok = promote("read_only")
	st, _ = getJSON(t, base+"/v1/admin/users?limit=1", tok)
	if st != 200 {
		t.Fatalf("read_only list: %d", st)
	}
	st, create := postJSON(t, base+"/v1/admin/users", tok, map[string]any{
		"phone": "13900000999", "password": "user12345", "username": "ro_create",
		"role": "member",
	})
	if st != 403 {
		t.Fatalf("read_only create status=%d want 403 %v", st, create)
	}
}
