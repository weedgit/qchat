package server_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/qchat/qchat/services/api/internal/auth"
	"github.com/qchat/qchat/services/api/internal/config"
)

func adminToken(t *testing.T, memberToken string) string {
	t.Helper()
	cfg := config.Load()
	claims, err := auth.ParseAccess(cfg.JWTSecret, memberToken)
	if err != nil {
		t.Fatalf("parse member token: %v", err)
	}
	token, err := auth.IssueAccess(
		cfg.JWTSecret, time.Minute, claims.UserID, claims.EnterpriseID,
		"enterprise_admin", claims.SessionID, claims.DeviceType, claims.DeviceID,
	)
	if err != nil {
		t.Fatalf("issue admin token: %v", err)
	}
	return token
}

func TestAdminListsAndRevokesUserSession(t *testing.T) {
	ts, cleanup := testServer(t)
	defer cleanup()

	memberAdminToken, _, _, _ := registerUser(t, ts.URL, "ACME2026")
	admin := adminToken(t, memberAdminToken)
	userToken, _, userID, _ := registerUser(t, ts.URL, "ACME2026")

	status, body := getJSON(
		t, fmt.Sprintf("%s/v1/admin/users/%s/sessions", ts.URL, userID), admin,
	)
	if status != 200 {
		t.Fatalf("list sessions: %d %v", status, body)
	}
	sessions, ok := body["sessions"].([]any)
	if !ok || len(sessions) != 1 {
		t.Fatalf("expected one active session: %v", body)
	}
	session, _ := sessions[0].(map[string]any)
	sessionID := fmt.Sprint(session["id"])
	if sessionID == "" || sessionID == "<nil>" {
		t.Fatalf("session id missing: %v", session)
	}
	if session["platform"] == nil || session["last_active_at"] == nil {
		t.Fatalf("session metadata missing: %v", session)
	}

	revokeURL := fmt.Sprintf(
		"%s/v1/admin/users/%s/sessions/%s/revoke", ts.URL, userID, sessionID,
	)
	status, _ = postJSON(t, revokeURL, admin, map[string]any{"reason": "short"})
	if status != 400 {
		t.Fatalf("short reason status = %d, want 400", status)
	}
	status, body = postJSON(
		t, revokeURL, admin, map[string]any{"reason": "support ticket #1234"},
	)
	if status != 200 {
		t.Fatalf("revoke session: %d %v", status, body)
	}

	status, body = getJSON(
		t, fmt.Sprintf("%s/v1/admin/users/%s/sessions", ts.URL, userID), admin,
	)
	if status != 200 {
		t.Fatalf("list after revoke: %d %v", status, body)
	}
	sessions, _ = body["sessions"].([]any)
	if len(sessions) != 0 {
		t.Fatalf("revoked session still active: %v", sessions)
	}

	status, _ = getJSON(t, ts.URL+"/v1/me", userToken)
	if status != 401 {
		t.Fatalf("revoked session API status = %d, want 401", status)
	}
}

func TestAdminCannotListCrossEnterpriseSessions(t *testing.T) {
	ts, cleanup := testServer(t)
	defer cleanup()

	memberAdminToken, _, _, _ := registerUser(t, ts.URL, "ACME2026")
	admin := adminToken(t, memberAdminToken)
	otherToken, _, otherUserID, _ := registerUser(t, ts.URL, "BETA2026")
	otherClaims, err := auth.ParseAccess(config.Load().JWTSecret, otherToken)
	if err != nil {
		t.Fatalf("parse other user token: %v", err)
	}

	status, _ := getJSON(
		t, fmt.Sprintf("%s/v1/admin/users/%s/sessions", ts.URL, otherUserID), admin,
	)
	if status != 404 {
		t.Fatalf("cross-enterprise session list status = %d, want 404", status)
	}

	revokeURL := fmt.Sprintf(
		"%s/v1/admin/users/%s/sessions/%s/revoke",
		ts.URL, otherUserID, otherClaims.SessionID,
	)
	status, _ = postJSON(
		t, revokeURL, admin, map[string]any{"reason": "support ticket #1234"},
	)
	if status != 404 {
		t.Fatalf("cross-enterprise revoke status = %d, want 404", status)
	}
	status, _ = getJSON(t, ts.URL+"/v1/me", otherToken)
	if status != 200 {
		t.Fatalf("cross-enterprise session was revoked: status = %d", status)
	}
}
