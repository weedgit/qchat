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
	"strings"
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
	cfg.Env = "test" // expose captcha dev_answer for automated tests
	cfg.ObjectStorageURL = "" // force local disk in tests
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
	id = fmt.Sprint(body["captcha_id"])
	code = fmt.Sprint(body["dev_answer"])
	if id == "" || id == "<nil>" || code == "" || code == "<nil>" {
		t.Fatalf("captcha missing id/dev_answer: %v", body)
	}
	img, _ := body["image"].(string)
	if !strings.HasPrefix(img, "data:image/png;base64,") {
		t.Fatalf("expected png data url, got %q", img)
	}
	if _, ok := body["challenge"]; ok {
		t.Fatalf("plaintext challenge must not be returned: %v", body)
	}
	return id, code
}

func postJSON(t *testing.T, url, token string, payload any) (int, map[string]any) {
	t.Helper()
	return postJSONWithIP(t, url, token, "", payload)
}

func postJSONWithIP(t *testing.T, url, token, realIP string, payload any) (int, map[string]any) {
	t.Helper()
	b, _ := json.Marshal(payload)
	req, _ := http.NewRequest(http.MethodPost, url, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if realIP != "" {
		req.Header.Set("X-Real-IP", realIP)
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

func deleteJSON(t *testing.T, url, token string) (int, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodDelete, url, nil)
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
	if invite == "" {
		t.Fatal("registerUser requires enterprise invite code")
	}
	cid, code := captcha(t, base)
	username = "u" + uuid.NewString()[:8]
	phone := fmt.Sprintf("139%08d", time.Now().UnixNano()%100000000)
	regPayload := map[string]any{
		"phone": phone, "password": "user12345", "username": username,
		"invite_code": invite,
		"captcha_id": cid, "captcha": code,
		"device_type": "web", "device_name": "test", "device_id": "test-device-" + username,
	}
	status, body := postJSON(t, base+"/v1/auth/register", "", regPayload)
	if status != 201 {
		t.Fatalf("register %s: %d %v", username, status, body)
	}
	token = fmt.Sprint(body["access_token"])
	refresh = fmt.Sprint(body["refresh_token"])
	userID = fmt.Sprint(body["user_id"])
	if body["enterprise_id"] == nil || fmt.Sprint(body["enterprise_id"]) == "" {
		t.Fatalf("register %s: expected enterprise_id from invite, got %v", username, body)
	}
	return token, refresh, userID, username
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

func TestMessageHistoryPagination(t *testing.T) {
	ts, cleanup := testServer(t)
	defer cleanup()
	base := ts.URL

	aTok, _, _, _ := registerUser(t, base, "ACME2026")
	bTok, _, bID, bName := registerUser(t, base, "ACME2026")
	req, _ := http.NewRequest(http.MethodPatch, base+"/v1/me", bytes.NewReader([]byte(`{"friend_privacy":"open"}`)))
	req.Header.Set("Authorization", "Bearer "+bTok)
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()

	st, _ := postJSON(t, base+"/v1/friends/request", aTok, map[string]any{"username": bName})
	if st != 201 {
		t.Fatalf("friend: %d", st)
	}
	st, dm := postJSON(t, base+"/v1/conversations/dm", aTok, map[string]any{"user_id": bID})
	if st != 200 && st != 201 {
		t.Fatalf("dm: %d %v", st, dm)
	}
	cid := fmt.Sprint(dm["id"])
	for i := 0; i < 12; i++ {
		st, msg := postJSON(t, base+"/v1/conversations/"+cid+"/messages", aTok, map[string]any{
			"type": "text", "body": fmt.Sprintf("page-%d", i), "client_msg_id": fmt.Sprintf("page-%d", i),
		})
		if st != 201 {
			t.Fatalf("send %d: %d %v", i, st, msg)
		}
	}

	st, page := getJSON(t, base+"/v1/conversations/"+cid+"/messages?limit=5", aTok)
	if st != 200 {
		t.Fatalf("list: %d %v", st, page)
	}
	if page["has_more"] != true {
		t.Fatalf("expected has_more=true: %v", page)
	}
	list, _ := page["messages"].([]any)
	if len(list) != 5 {
		t.Fatalf("page size = %d, want 5", len(list))
	}
	first := list[0].(map[string]any)
	oldestSeq := int64(first["seq"].(float64))
	if fmt.Sprint(first["body"]) != "page-7" {
		t.Fatalf("expected oldest body page-7, got %v", first["body"])
	}

	st, older := getJSON(
		t, fmt.Sprintf("%s/v1/conversations/%s/messages?limit=5&before_seq=%d", base, cid, oldestSeq), aTok,
	)
	if st != 200 {
		t.Fatalf("older list: %d %v", st, older)
	}
	olderList, _ := older["messages"].([]any)
	if len(olderList) != 5 {
		t.Fatalf("older page size = %d, want 5", len(olderList))
	}
	if older["has_more"] != true {
		t.Fatalf("expected older has_more=true: %v", older)
	}
	for _, item := range olderList {
		m := item.(map[string]any)
		if int64(m["seq"].(float64)) >= oldestSeq {
			t.Fatalf("older page included seq >= cursor: %v", m)
		}
	}
}

func TestGroupInviteNonFriend(t *testing.T) {
	ts, cleanup := testServer(t)
	defer cleanup()
	base := ts.URL

	ownerTok, _, _, _ := registerUser(t, base, "ACME2026")
	// Peer keeps default approval privacy — no friendship with owner.
	_, _, peerID, peerName := registerUser(t, base, "ACME2026")

	st, g := postJSON(t, base+"/v1/groups", ownerTok, map[string]any{
		"title": "Open Invite", "member_ids": []string{peerID},
	})
	if st != 201 {
		t.Fatalf("create with non-friend: %d %v", st, g)
	}
	gid := fmt.Sprint(g["id"])

	st, details := getJSON(t, base+"/v1/groups/"+gid, ownerTok)
	if st != 200 {
		t.Fatalf("group details: %d %v", st, details)
	}
	members, _ := details["members"].([]any)
	found := false
	for _, item := range members {
		m, _ := item.(map[string]any)
		if fmt.Sprint(m["user_id"]) == peerID {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("non-friend %s (%s) should be a member after create: %v", peerName, peerID, details)
	}

	extraTok, _, extraID, _ := registerUser(t, base, "ACME2026")
	_ = extraTok
	st, add := postJSON(t, base+"/v1/groups/"+gid+"/members", ownerTok, map[string]any{
		"member_ids": []string{extraID},
	})
	if st != 200 {
		t.Fatalf("add non-friend: %d %v", st, add)
	}
	added, _ := add["added"].([]any)
	if len(added) != 1 || fmt.Sprint(added[0]) != extraID {
		t.Fatalf("expected added=[%s], got %v", extraID, add)
	}
}

func TestUserLookupSameTenantOnly(t *testing.T) {
	ts, cleanup := testServer(t)
	defer cleanup()
	base := ts.URL

	entTok, _, _, _ := registerUser(t, base, "ACME2026")
	peerTok, _, _, peerName := registerUser(t, base, "ACME2026")
	_ = peerTok

	prefix := peerName
	if len(prefix) > 3 {
		prefix = prefix[:3]
	}
	st, look := getJSON(t, base+"/v1/users/lookup?q="+prefix, entTok)
	if st != 200 {
		t.Fatalf("lookup: %d %v", st, look)
	}
	users, _ := look["users"].([]any)
	found := false
	for _, item := range users {
		m, _ := item.(map[string]any)
		if fmt.Sprint(m["username"]) == peerName {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("prefix %q should find same-tenant user %s: %v", prefix, peerName, look)
	}

	// Cross-enterprise still blocked for other-tenant members.
	otherTok, _, _, otherName := registerUser(t, base, "BETA2026")
	st, look = getJSON(t, base+"/v1/users/lookup?q="+otherName, entTok)
	if st != 200 {
		t.Fatalf("cross lookup: %d", st)
	}
	users, _ = look["users"].([]any)
	for _, item := range users {
		m, _ := item.(map[string]any)
		if fmt.Sprint(m["username"]) == otherName {
			t.Fatalf("enterprise lookup leaked other-tenant user: %v", look)
		}
	}
	_ = otherTok
}

func TestGroupLeaveNoticeAndPreJoinHistory(t *testing.T) {
	ts, cleanup := testServer(t)
	defer cleanup()
	base := ts.URL

	ownerTok, _, _, _ := registerUser(t, base, "ACME2026")
	memberTok, _, memberID, memberName := registerUser(t, base, "ACME2026")
	otherTok, _, otherID, otherName := registerUser(t, base, "ACME2026")
	lateTok, _, lateID, _ := registerUser(t, base, "ACME2026")

	for _, tok := range []string{memberTok, otherTok, lateTok} {
		req, _ := http.NewRequest(http.MethodPatch, base+"/v1/me", bytes.NewReader([]byte(`{"friend_privacy":"open"}`)))
		req.Header.Set("Authorization", "Bearer "+tok)
		req.Header.Set("Content-Type", "application/json")
		res, _ := http.DefaultClient.Do(req)
		res.Body.Close()
	}

	st, _ := postJSON(t, base+"/v1/friends/request", ownerTok, map[string]any{"username": memberName})
	if st != 201 {
		t.Fatalf("friend member: %d", st)
	}
	st, _ = postJSON(t, base+"/v1/friends/request", ownerTok, map[string]any{"username": otherName})
	if st != 201 {
		t.Fatalf("friend other: %d", st)
	}

	st, g := postJSON(t, base+"/v1/groups", ownerTok, map[string]any{
		"title": "Leave Hist Group", "member_ids": []string{memberID, otherID},
	})
	if st != 201 {
		t.Fatalf("group: %d %v", st, g)
	}
	gid := fmt.Sprint(g["id"])

	st, msg := postJSON(t, base+"/v1/conversations/"+gid+"/messages", ownerTok, map[string]any{
		"type": "text", "body": "before-join", "client_msg_id": "hist-1",
	})
	if st != 201 {
		t.Fatalf("send: %d %v", st, msg)
	}
	mid := fmt.Sprint(msg["id"])

	st, _ = postJSON(t, base+"/v1/messages/"+mid+"/pin", ownerTok, map[string]any{})
	if st != 200 {
		t.Fatalf("pin: %d", st)
	}

	time.Sleep(20 * time.Millisecond)

	st, add := postJSON(t, base+"/v1/groups/"+gid+"/members", ownerTok, map[string]any{
		"member_ids": []string{lateID},
	})
	if st != 200 && st != 201 {
		t.Fatalf("add late: %d %v", st, add)
	}

	_, lateMsgs := getJSON(t, base+"/v1/conversations/"+gid+"/messages", lateTok)
	llist, _ := lateMsgs["messages"].([]any)
	for _, item := range llist {
		m := item.(map[string]any)
		if fmt.Sprint(m["id"]) == mid || fmt.Sprint(m["body"]) == "before-join" {
			t.Fatalf("late joiner saw pre-join message: %v", m)
		}
	}

	_, lateConvs := getJSON(t, base+"/v1/conversations", lateTok)
	crows, _ := lateConvs["conversations"].([]any)
	foundLate := false
	for _, item := range crows {
		c, _ := item.(map[string]any)
		if fmt.Sprint(c["id"]) != gid {
			continue
		}
		foundLate = true
		pins, _ := c["pinned_messages"].([]any)
		if len(pins) != 0 {
			t.Fatalf("late joiner should not see pre-join pins: %v", pins)
		}
	}
	if !foundLate {
		t.Fatalf("late joiner missing group in conversations: %v", lateConvs)
	}

	st, _ = postJSON(t, base+"/v1/groups/"+gid+"/leave", memberTok, map[string]any{})
	if st != 200 {
		t.Fatalf("leave: %d", st)
	}

	_, ownerMsgs := getJSON(t, base+"/v1/conversations/"+gid+"/messages", ownerTok)
	olist, _ := ownerMsgs["messages"].([]any)
	ownerSeesNotice := false
	for _, item := range olist {
		m := item.(map[string]any)
		if fmt.Sprint(m["type"]) == "system" && strings.Contains(fmt.Sprint(m["body"]), "member_left") {
			ownerSeesNotice = true
		}
	}
	if !ownerSeesNotice {
		t.Fatalf("owner should see leave system notice: %v", olist)
	}

	_, otherMsgs := getJSON(t, base+"/v1/conversations/"+gid+"/messages", otherTok)
	mlist, _ := otherMsgs["messages"].([]any)
	for _, item := range mlist {
		m := item.(map[string]any)
		if fmt.Sprint(m["type"]) == "system" {
			t.Fatalf("ordinary member should not see leave notice: %v", m)
		}
	}
}
