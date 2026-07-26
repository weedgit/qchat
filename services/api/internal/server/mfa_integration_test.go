package server_test

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/qchat/qchat/services/api/internal/auth"
	"github.com/qchat/qchat/services/api/internal/db"
)

func TestAdminMFALoginGating(t *testing.T) {
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
		t.Fatalf("promote admin: %v", err)
	}

	st, me := getJSON(t, base+"/v1/me", admin)
	if st != 200 {
		t.Fatalf("me: %d %v", st, me)
	}
	phone := fmt.Sprint(me["phone"])
	if phone == "" || phone == "<nil>" {
		t.Fatalf("phone missing: %v", me)
	}

	st, status := getJSON(t, base+"/v1/me/mfa", admin)
	if st != 200 || status["mfa_active"] != false {
		t.Fatalf("mfa status: %d %v", st, status)
	}

	st, setup := postJSON(t, base+"/v1/me/mfa/setup", admin, map[string]any{})
	if st != 200 {
		t.Fatalf("setup: %d %v", st, setup)
	}
	secret := fmt.Sprint(setup["secret"])
	if secret == "" || setup["otpauth_uri"] == nil {
		t.Fatalf("setup payload incomplete: %v", setup)
	}

	st, _ = postJSON(t, base+"/v1/me/mfa/activate", admin, map[string]any{"code": "000000"})
	if st != 401 {
		t.Fatalf("bad activate status = %d, want 401", st)
	}

	code := currentTOTP(t, secret)
	st, act := postJSON(t, base+"/v1/me/mfa/activate", admin, map[string]any{"code": code})
	if st != 200 || act["mfa_active"] != true {
		t.Fatalf("activate: %d %v", st, act)
	}

	cid, captchaCode := captcha(t, base)
	st, login := postJSON(t, base+"/v1/auth/login", "", map[string]any{
		"phone": phone, "password": "user12345",
		"captcha_id": cid, "captcha": captchaCode,
		"device_type": "web", "device_name": "admin-web", "platform": "Admin · Web",
		"remember_me": true,
	})
	if st != 401 || fmt.Sprint(login["code"]) != "mfa_required" {
		t.Fatalf("login without MFA: %d %v", st, login)
	}

	cid2, captchaCode2 := captcha(t, base)
	st, loginBad := postJSON(t, base+"/v1/auth/login", "", map[string]any{
		"phone": phone, "password": "user12345",
		"captcha_id": cid2, "captcha": captchaCode2,
		"device_type": "web", "mfa_code": "000000",
		"remember_me": true,
	})
	if st != 401 || fmt.Sprint(loginBad["code"]) != "mfa_invalid" {
		t.Fatalf("login bad MFA: %d %v", st, loginBad)
	}

	cid3, captchaCode3 := captcha(t, base)
	st, loginOK := postJSON(t, base+"/v1/auth/login", "", map[string]any{
		"phone": phone, "password": "user12345",
		"captcha_id": cid3, "captcha": captchaCode3,
		"device_type": "web", "mfa_code": currentTOTP(t, secret),
		"remember_me": true,
	})
	if st != 200 || loginOK["access_token"] == nil {
		t.Fatalf("login with MFA: %d %v", st, loginOK)
	}
	freshAdmin := fmt.Sprint(loginOK["access_token"])

	disableCode := currentTOTP(t, secret)
	st, dis := postJSON(t, base+"/v1/me/mfa/disable", freshAdmin, map[string]any{"code": disableCode})
	if st != 200 || dis["mfa_active"] != false {
		t.Fatalf("disable: %d %v", st, dis)
	}
}

func currentTOTP(t *testing.T, secret string) string {
	t.Helper()
	code, err := auth.TOTPCode(secret, time.Now())
	if err != nil {
		t.Fatalf("totp: %v", err)
	}
	return code
}
