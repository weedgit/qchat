package server_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/qchat/qchat/services/api/internal/auth"
	"github.com/qchat/qchat/services/api/internal/config"
)

func platformOwnerToken(t *testing.T, memberToken string) string {
	t.Helper()
	cfg := config.Load()
	claims, err := auth.ParseAccess(cfg.JWTSecret, memberToken)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	token, err := auth.IssueAccess(
		cfg.JWTSecret, time.Minute, claims.UserID, claims.EnterpriseID,
		"platform_owner", claims.SessionID, claims.DeviceType, claims.DeviceID,
	)
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	return token
}

func TestPlatformOwnerCreatesEnterpriseWithAdmin(t *testing.T) {
	ts, cleanup := testServer(t)
	defer cleanup()
	base := ts.URL

	memberTok, _, _, _ := registerUser(t, base, "ACME2026")
	owner := platformOwnerToken(t, memberTok)

	phone := fmt.Sprintf("138%08d", time.Now().UnixNano()%100000000)
	uname := "eadm" + uuid.NewString()[:6]
	st, body := postJSON(t, base+"/v1/admin/enterprises", owner, map[string]any{
		"name":           "Gamma Co",
		"admin_phone":    phone,
		"admin_password": "AdminPass1",
		"admin_username": uname,
	})
	if st != 201 {
		t.Fatalf("create enterprise: %d %v", st, body)
	}
	if body["invite_code"] == nil || body["admin_user_id"] == nil {
		t.Fatalf("missing fields: %v", body)
	}
	entID := fmt.Sprint(body["id"])

	// Enterprise admin cannot create another enterprise_admin.
	adminTok, _, _, _ := registerUser(t, base, "ACME2026")
	admin := adminToken(t, adminTok)
	st, denied := postJSON(t, base+"/v1/admin/users", admin, map[string]any{
		"phone":    fmt.Sprintf("137%08d", time.Now().UnixNano()%100000000),
		"password": "AdminPass1",
		"username": "xadm" + uuid.NewString()[:6],
		"role":     "enterprise_admin",
	})
	if st != 403 {
		t.Fatalf("tenant admin issue admin: %d %v", st, denied)
	}

	// Platform owner can issue admin into the new enterprise.
	phone2 := fmt.Sprintf("136%08d", time.Now().UnixNano()%100000000)
	uname2 := "eadm" + uuid.NewString()[:6]
	st, issued := postJSON(t, base+"/v1/admin/users", owner, map[string]any{
		"phone":         phone2,
		"password":      "AdminPass1",
		"username":      uname2,
		"role":          "enterprise_admin",
		"enterprise_id": entID,
	})
	if st != 201 || fmt.Sprint(issued["enterprise_id"]) != entID {
		t.Fatalf("issue admin: %d %v", st, issued)
	}
}

func TestCreateEnterpriseRequiresAdmin(t *testing.T) {
	ts, cleanup := testServer(t)
	defer cleanup()
	memberTok, _, _, _ := registerUser(t, ts.URL, "ACME2026")
	owner := platformOwnerToken(t, memberTok)

	st, body := postJSON(t, ts.URL+"/v1/admin/enterprises", owner, map[string]any{
		"name": "No Admin Co",
	})
	if st != 400 {
		t.Fatalf("expected 400 without admin phone: %d %v", st, body)
	}
}
