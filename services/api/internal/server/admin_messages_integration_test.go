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
	if len(msgs) < 2 {
		t.Fatalf("expected peer + self messages, got %v", body)
	}
	bodies := map[string]bool{}
	for _, item := range msgs {
		m := item.(map[string]any)
		bodies[fmt.Sprint(m["body"])] = true
		if m["sender_username"] == nil || m["conversation_type"] == nil {
			t.Fatalf("missing enrichment: %v", m)
		}
	}
	if !bodies["from-a"] || !bodies["from-b"] {
		t.Fatalf("missing expected bodies: %v", bodies)
	}

	q.Set("scope", "sent")
	st, sent := getJSON(t, base+"/v1/admin/messages?"+q.Encode(), admin)
	if st != 200 {
		t.Fatalf("inspect sent: %d %v", st, sent)
	}
	sentMsgs, _ := sent["messages"].([]any)
	for _, item := range sentMsgs {
		m := item.(map[string]any)
		if fmt.Sprint(m["sender_id"]) != aID {
			t.Fatalf("sent scope leaked peer message: %v", m)
		}
	}
	_ = bID
}
