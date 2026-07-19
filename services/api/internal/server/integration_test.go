package server_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/qchat/qchat/services/api/internal/config"
	"github.com/qchat/qchat/services/api/internal/db"
	"github.com/qchat/qchat/services/api/internal/migrate"
	"github.com/qchat/qchat/services/api/internal/server"
	"github.com/qchat/qchat/services/api/internal/ws"
)

func testServer(t *testing.T) (*httptest.Server, func()) {
	t.Helper()
	dsn := os.Getenv("QCHAT_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://qchat:qchat@localhost:5432/qchat?sslmode=disable"
	}
	ctx := context.Background()
	pool, err := db.Connect(ctx, dsn)
	if err != nil {
		t.Skipf("db unavailable: %v", err)
	}
	if err := migrate.Up(ctx, pool); err != nil {
		pool.Close()
		t.Fatalf("migrate: %v", err)
	}
	cfg := config.Load()
	cfg.AccessTTL = time.Minute
	cfg.RefreshTTL = time.Hour
	hub := ws.NewHub()
	srv := server.New(cfg, pool, hub)
	ts := httptest.NewServer(srv.Handler())
	cleanup := func() {
		ts.Close()
		pool.Close()
	}
	return ts, cleanup
}

func captcha(t *testing.T, base string) (id, code string) {
	t.Helper()
	res, err := http.Get(base + "/v1/auth/captcha")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var body map[string]any
	_ = json.NewDecoder(res.Body).Decode(&body)
	return fmt.Sprint(body["captcha_id"]), fmt.Sprint(body["challenge"])
}

func postJSON(t *testing.T, url, token string, payload any) (int, map[string]any) {
	t.Helper()
	b, _ := json.Marshal(payload)
	req, _ := http.NewRequest(http.MethodPost, url, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	var body map[string]any
	_ = json.Unmarshal(raw, &body)
	return res.StatusCode, body
}

func getJSON(t *testing.T, url, token string) (int, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, url, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var body map[string]any
	_ = json.NewDecoder(res.Body).Decode(&body)
	return res.StatusCode, body
}

func registerUser(t *testing.T, base, invite string) (token, refresh, userID, username string) {
	t.Helper()
	cid, code := captcha(t, base)
	username = "u" + uuid.NewString()[:8]
	phone := fmt.Sprintf("139%08d", time.Now().UnixNano()%100000000)
	status, body := postJSON(t, base+"/v1/auth/register", "", map[string]any{
		"phone": phone, "password": "user12345", "username": username,
		"invite_code": invite, "captcha_id": cid, "captcha": code,
		"device_type": "web", "device_name": "test",
	})
	if status != 201 {
		t.Fatalf("register %s: %d %v", username, status, body)
	}
	return fmt.Sprint(body["access_token"]), fmt.Sprint(body["refresh_token"]), fmt.Sprint(body["user_id"]), username
}

func TestTwoUserDMAndRecall(t *testing.T) {
	ts, cleanup := testServer(t)
	defer cleanup()
	base := ts.URL

	aTok, _, aID, aName := registerUser(t, base, "ACME2026")
	bTok, _, bID, bName := registerUser(t, base, "ACME2026")
	_ = aID

	// set bob approval
	status, _ := postJSON(t, base+"/v1/me", bTok, map[string]any{}) // wrong method - use PATCH via NewRequest
	_ = status
	req, _ := http.NewRequest(http.MethodPatch, base+"/v1/me", bytes.NewReader([]byte(`{"friend_privacy":"approval"}`)))
	req.Header.Set("Authorization", "Bearer "+bTok)
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()

	st, body := postJSON(t, base+"/v1/friends/request", aTok, map[string]any{"username": bName})
	if st != 201 || body["status"] != "pending" {
		t.Fatalf("friend request: %d %v", st, body)
	}
	_, friends := getJSON(t, base+"/v1/friends", bTok)
	list, _ := friends["friends"].([]any)
	var fid string
	for _, item := range list {
		m := item.(map[string]any)
		if m["username"] == aName && m["incoming"] == true {
			fid = fmt.Sprint(m["friendship_id"])
		}
	}
	if fid == "" {
		t.Fatal("no incoming request")
	}
	st, _ = postJSON(t, base+"/v1/friends/"+fid+"/accept", bTok, map[string]any{})
	if st != 200 {
		t.Fatalf("accept: %d", st)
	}

	st, dm := postJSON(t, base+"/v1/conversations/dm", aTok, map[string]any{"user_id": bID})
	if st != 200 && st != 201 {
		t.Fatalf("dm: %d %v", st, dm)
	}
	cid := fmt.Sprint(dm["id"])
	st, msg := postJSON(t, base+"/v1/conversations/"+cid+"/messages", aTok, map[string]any{
		"type": "text", "body": "hello integration", "client_msg_id": "it-1",
	})
	if st != 201 {
		t.Fatalf("send: %d %v", st, msg)
	}
	mid := fmt.Sprint(msg["id"])
	st, _ = postJSON(t, base+"/v1/messages/"+mid+"/recall", aTok, map[string]any{})
	if st != 200 {
		t.Fatalf("recall: %d", st)
	}
	_, msgs := getJSON(t, base+"/v1/conversations/"+cid+"/messages", bTok)
	mlist, _ := msgs["messages"].([]any)
	found := false
	for _, item := range mlist {
		m := item.(map[string]any)
		if fmt.Sprint(m["id"]) == mid {
			found = true
			if m["recalled"] != true || m["body"] != "" {
				t.Fatalf("dm recall notice missing: %v", m)
			}
		}
	}
	if !found {
		t.Fatal("recalled dm message missing for peer")
	}
}

func TestGroupRecallVisibilityAndTenantIsolation(t *testing.T) {
	ts, cleanup := testServer(t)
	defer cleanup()
	base := ts.URL

	ownerTok, _, ownerID, _ := registerUser(t, base, "ACME2026")
	memberTok, _, memberID, memberName := registerUser(t, base, "ACME2026")
	otherEntTok, _, _, _ := registerUser(t, base, "BETA2026")

	// open friendship + group
	req, _ := http.NewRequest(http.MethodPatch, base+"/v1/me", bytes.NewReader([]byte(`{"friend_privacy":"open"}`)))
	req.Header.Set("Authorization", "Bearer "+memberTok)
	req.Header.Set("Content-Type", "application/json")
	res, _ := http.DefaultClient.Do(req)
	res.Body.Close()

	st, _ := postJSON(t, base+"/v1/friends/request", ownerTok, map[string]any{"username": memberName})
	if st != 201 {
		t.Fatalf("friend: %d", st)
	}
	st, g := postJSON(t, base+"/v1/groups", ownerTok, map[string]any{
		"title": "Recall Group", "member_ids": []string{memberID},
	})
	if st != 201 {
		t.Fatalf("group: %d %v", st, g)
	}
	gid := fmt.Sprint(g["id"])
	st, msg := postJSON(t, base+"/v1/conversations/"+gid+"/messages", ownerTok, map[string]any{
		"type": "text", "body": "secret", "client_msg_id": "g-1",
	})
	if st != 201 {
		t.Fatalf("send: %d %v", st, msg)
	}
	mid := fmt.Sprint(msg["id"])
	st, _ = postJSON(t, base+"/v1/messages/"+mid+"/recall", ownerTok, map[string]any{})
	if st != 200 {
		t.Fatalf("recall: %d", st)
	}

	_, ownerMsgs := getJSON(t, base+"/v1/conversations/"+gid+"/messages", ownerTok)
	olist, _ := ownerMsgs["messages"].([]any)
	ownerSees := false
	for _, item := range olist {
		m := item.(map[string]any)
		if fmt.Sprint(m["id"]) == mid && m["recalled"] == true {
			ownerSees = true
		}
	}
	if !ownerSees {
		t.Fatal("owner should see recall notice")
	}

	_, memberMsgs := getJSON(t, base+"/v1/conversations/"+gid+"/messages", memberTok)
	mlist, _ := memberMsgs["messages"].([]any)
	for _, item := range mlist {
		m := item.(map[string]any)
		if fmt.Sprint(m["id"]) == mid {
			t.Fatalf("ordinary member should not see recalled message: %v", m)
		}
	}

	// tenant isolation: other enterprise cannot open DM / list friends across tenants
	st, body := postJSON(t, base+"/v1/conversations/dm", otherEntTok, map[string]any{"user_id": ownerID})
	if st == 200 || st == 201 {
		t.Fatalf("cross-tenant DM should fail, got %d %v", st, body)
	}
	st, look := getJSON(t, base+"/v1/users/lookup?q="+memberName, otherEntTok)
	if st != 200 {
		t.Fatalf("lookup: %d", st)
	}
	users, _ := look["users"].([]any)
	if len(users) != 0 {
		t.Fatalf("cross-tenant lookup leaked users: %v", users)
	}
}

func TestRefreshRotationAndBlock(t *testing.T) {
	ts, cleanup := testServer(t)
	defer cleanup()
	base := ts.URL

	_, aRefresh, _, _ := registerUser(t, base, "ACME2026")

	st, body := postJSON(t, base+"/v1/auth/refresh", "", map[string]any{"refresh_token": aRefresh})
	if st != 200 {
		t.Fatalf("refresh: %d %v", st, body)
	}
	newRefresh := fmt.Sprint(body["refresh_token"])
	st, _ = postJSON(t, base+"/v1/auth/refresh", "", map[string]any{"refresh_token": newRefresh})
	if st != 200 {
		t.Fatalf("rotated refresh should work: %d", st)
	}
	st, reused := postJSON(t, base+"/v1/auth/refresh", "", map[string]any{"refresh_token": aRefresh})
	if st == 200 {
		t.Fatalf("reused refresh should fail, got %v", reused)
	}

	aTok, _, _, aName := registerUser(t, base, "ACME2026")
	bTok, _, bID, bName := registerUser(t, base, "ACME2026")
	req, _ := http.NewRequest(http.MethodPatch, base+"/v1/me", bytes.NewReader([]byte(`{"friend_privacy":"open"}`)))
	req.Header.Set("Authorization", "Bearer "+bTok)
	req.Header.Set("Content-Type", "application/json")
	res, _ := http.DefaultClient.Do(req)
	res.Body.Close()
	st, _ = postJSON(t, base+"/v1/friends/request", aTok, map[string]any{"username": bName})
	if st != 201 {
		t.Fatalf("friend: %d", st)
	}
	st, _ = postJSON(t, base+"/v1/friends/"+bID+"/block", aTok, map[string]any{})
	if st != 200 {
		t.Fatalf("block: %d", st)
	}
	st, blockedReq := postJSON(t, base+"/v1/friends/request", bTok, map[string]any{"username": aName})
	if st == 201 {
		t.Fatalf("blocked user should not re-request: %v", blockedReq)
	}
}
