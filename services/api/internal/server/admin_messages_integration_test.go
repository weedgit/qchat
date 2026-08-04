package server_test

import (
	"fmt"
	"net/url"
	"testing"
)

func TestAdminMessageInspectIncludesPeerMessages(t *testing.T) {
	ts, cleanup := testServer(t)
	defer cleanup()
	base := ts.URL

	aTok, _, aID, aName := registerUser(t, base, "ACME2026")
	bTok, _, bID, bName := registerUser(t, base, "ACME2026")
	admin := adminToken(t, aTok)

	// Open friendship and DM.
	st, _ := postJSON(t, base+"/v1/friends/request", aTok, map[string]any{"username": bName})
	if st != 201 {
		t.Fatalf("friend a→b: %d", st)
	}
	st, friends := getJSON(t, base+"/v1/friends", bTok)
	if st != 200 {
		t.Fatalf("friends: %d", st)
	}
	list, _ := friends["friends"].([]any)
	var fid string
	for _, item := range list {
		m := item.(map[string]any)
		if m["username"] == aName && m["incoming"] == true {
			fid = fmt.Sprint(m["friendship_id"])
		}
	}
	if fid == "" {
		t.Fatal("no incoming friendship")
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
	st, _ = postJSON(t, base+"/v1/conversations/"+cid+"/messages", aTok, map[string]any{
		"type": "text", "body": "from-a", "client_msg_id": "insp-a-1",
	})
	if st != 201 {
		t.Fatalf("send a: %d", st)
	}
	st, _ = postJSON(t, base+"/v1/conversations/"+cid+"/messages", bTok, map[string]any{
		"type": "text", "body": "from-b", "client_msg_id": "insp-b-1",
	})
	if st != 201 {
		t.Fatalf("send b: %d", st)
	}

	st, g := postJSON(t, base+"/v1/groups", aTok, map[string]any{
		"title": "Inspect Group", "member_ids": []string{bID},
	})
	if st != 201 {
		t.Fatalf("group: %d %v", st, g)
	}
	gid := fmt.Sprint(g["id"])
	st, _ = postJSON(t, base+"/v1/conversations/"+gid+"/messages", aTok, map[string]any{
		"type": "text", "body": "from-group", "client_msg_id": "insp-g-1",
	})
	if st != 201 {
		t.Fatalf("send group: %d", st)
	}

	q := url.Values{
		"user_id": {aID},
		"reason":  {"compliance ticket inspect peer traffic"},
		"scope":   {"all"},
		"limit":   {"50"},
		"offset":  {"0"},
	}
	st, body := getJSON(t, base+"/v1/admin/messages?"+q.Encode(), admin)
	if st != 200 {
		t.Fatalf("inspect all: %d %v", st, body)
	}
	msgs, _ := body["messages"].([]any)
	if len(msgs) < 3 {
		t.Fatalf("expected dm + group messages, got %v", body)
	}
	bodies := map[string]bool{}
	for _, item := range msgs {
		m := item.(map[string]any)
		bodies[fmt.Sprint(m["body"])] = true
		if m["sender_username"] == nil || m["conversation_type"] == nil {
			t.Fatalf("missing enrichment: %v", m)
		}
	}
	if !bodies["from-a"] || !bodies["from-b"] || !bodies["from-group"] {
		t.Fatalf("missing expected bodies: %v", bodies)
	}

	q.Set("scope", "dm")
	st, dmBody := getJSON(t, base+"/v1/admin/messages?"+q.Encode(), admin)
	if st != 200 {
		t.Fatalf("inspect dm: %d %v", st, dmBody)
	}
	dmMsgs, _ := dmBody["messages"].([]any)
	if len(dmMsgs) < 2 {
		t.Fatalf("expected dm messages, got %v", dmBody)
	}
	for _, item := range dmMsgs {
		m := item.(map[string]any)
		if fmt.Sprint(m["conversation_type"]) != "dm" {
			t.Fatalf("dm scope leaked non-dm message: %v", m)
		}
	}

	q.Set("scope", "group")
	st, groupBody := getJSON(t, base+"/v1/admin/messages?"+q.Encode(), admin)
	if st != 200 {
		t.Fatalf("inspect group: %d %v", st, groupBody)
	}
	groupMsgs, _ := groupBody["messages"].([]any)
	if len(groupMsgs) < 1 {
		t.Fatalf("expected group messages, got %v", groupBody)
	}
	for _, item := range groupMsgs {
		m := item.(map[string]any)
		if fmt.Sprint(m["conversation_type"]) != "social_group" {
			t.Fatalf("group scope leaked non-group message: %v", m)
		}
	}

	q.Set("scope", "group")
	q.Set("group", "Inspect Group")
	st, namedBody := getJSON(t, base+"/v1/admin/messages?"+q.Encode(), admin)
	if st != 200 {
		t.Fatalf("inspect group name: %d %v", st, namedBody)
	}
	namedMsgs, _ := namedBody["messages"].([]any)
	if len(namedMsgs) < 1 {
		t.Fatalf("expected group name filter messages, got %v", namedBody)
	}
	for _, item := range namedMsgs {
		m := item.(map[string]any)
		if fmt.Sprint(m["conversation_title"]) != "Inspect Group" {
			t.Fatalf("group name filter leaked: %v", m)
		}
	}

	q.Set("group", "no-such-group-xyz")
	st, emptyBody := getJSON(t, base+"/v1/admin/messages?"+q.Encode(), admin)
	if st != 200 {
		t.Fatalf("inspect empty group name: %d %v", st, emptyBody)
	}
	emptyMsgs, _ := emptyBody["messages"].([]any)
	if len(emptyMsgs) != 0 {
		t.Fatalf("expected no messages for unknown group name, got %v", emptyBody)
	}
	_ = bID
}

func TestAdminMessageInspectTypeAndTextFilters(t *testing.T) {
	ts, cleanup := testServer(t)
	defer cleanup()
	base := ts.URL

	aTok, _, _, _ := registerUser(t, base, "ACME2026")
	admin := adminToken(t, aTok)

	st, g := postJSON(t, base+"/v1/groups", aTok, map[string]any{"title": "Filter Group"})
	if st != 201 {
		t.Fatalf("group: %d %v", st, g)
	}
	gid := fmt.Sprint(g["id"])
	st, _ = postJSON(t, base+"/v1/conversations/"+gid+"/messages", aTok, map[string]any{
		"type": "text", "body": "hello filter world", "client_msg_id": "filt-text-1",
	})
	if st != 201 {
		t.Fatalf("send text: %d", st)
	}
	st, _ = postJSON(t, base+"/v1/conversations/"+gid+"/messages", aTok, map[string]any{
		"type": "text", "body": "other message", "client_msg_id": "filt-text-2",
	})
	if st != 201 {
		t.Fatalf("send text2: %d", st)
	}

	q := url.Values{
		"reason":       {"compliance ticket text filter"},
		"scope":        {"all"},
		"message_type": {"text"},
		"text":         {"filter"},
		"limit":        {"50"},
	}
	st, body := getJSON(t, base+"/v1/admin/messages?"+q.Encode(), admin)
	if st != 200 {
		t.Fatalf("inspect filtered: %d %v", st, body)
	}
	msgs, _ := body["messages"].([]any)
	if len(msgs) != 1 {
		t.Fatalf("expected 1 filtered message, got %v", body)
	}
	m := msgs[0].(map[string]any)
	if fmt.Sprint(m["body"]) != "hello filter world" {
		t.Fatalf("wrong body: %v", m)
	}
}

func TestAdminMessageInspectEnterpriseWithoutReason(t *testing.T) {
	ts, cleanup := testServer(t)
	defer cleanup()
	base := ts.URL

	aTok, _, _, _ := registerUser(t, base, "ACME2026")
	admin := adminToken(t, aTok)

	st, body := getJSON(t, base+"/v1/admin/messages?scope=all&limit=10&offset=0", admin)
	if st != 200 {
		t.Fatalf("enterprise inspect without reason: %d %v", st, body)
	}
	if body["messages"] == nil {
		t.Fatalf("expected messages array: %v", body)
	}
}
