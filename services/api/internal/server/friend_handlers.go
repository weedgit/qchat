package server

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/qchat/qchat/services/api/internal/ws"
)

func (s *Server) handleListFriends(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	statusFilter := r.URL.Query().Get("status")
	rows, err := s.db.Query(r.Context(), `
		SELECT f.id::text,
			CASE WHEN f.requester_id=$1 THEN f.addressee_id ELSE f.requester_id END::text,
			u.username, u.display_name, u.avatar_url,
			COALESCE(p.note, ''), COALESCE(p.tags, '{}'), f.status,
			(f.addressee_id=$1 AND f.status='pending') AS incoming,
			(f.requester_id=$1) AS outgoing
		FROM friendships f
		JOIN users u ON u.id = CASE WHEN f.requester_id=$1 THEN f.addressee_id ELSE f.requester_id END
		LEFT JOIN friendship_user_preferences p
		  ON p.friendship_id = f.id AND p.user_id = $1
		WHERE (f.requester_id=$1 OR f.addressee_id=$1)
		  AND (
		    ($2 = '' AND f.status IN ('accepted','pending','blocked'))
		    OR f.status = $2
		  )
		ORDER BY f.created_at DESC`, c.UserID, statusFilter)
	if err != nil {
		writeErrCode(w, 500, "query_failed", "query failed")
		return
	}
	defer rows.Close()
	var out []map[string]any
	var ids []string
	for rows.Next() {
		var id, uid, uname, dname, avatar, note, status string
		var tags []string
		var incoming, outgoing bool
		if err := rows.Scan(&id, &uid, &uname, &dname, &avatar, &note, &tags, &status, &incoming, &outgoing); err != nil {
			continue
		}
		if tags == nil {
			tags = []string{}
		}
		// Only show blocked rows where current user is the blocker (requester of block).
		if status == "blocked" && !outgoing {
			continue
		}
		ids = append(ids, uid)
		out = append(out, map[string]any{
			"friendship_id": id, "user_id": uid, "username": uname, "display_name": dname,
			"avatar_url": avatar, "note": note, "tags": tags, "status": status,
			"incoming": incoming, "outgoing": outgoing,
		})
	}
	online := s.hub.OnlineUserIDs(ids)
	for _, item := range out {
		item["online"] = online[item["user_id"].(string)]
	}
	if out == nil {
		out = []map[string]any{}
	}
	writeJSON(w, 200, map[string]any{"friends": out})
}

func (s *Server) handleUserLookup(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	if c.EnterpriseID == "" {
		writeErrCode(w, 403, "no_enterprise", "enterprise required")
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		writeErrCode(w, 400, "invalid_request", "q required")
		return
	}
	// Same-tenant only (username / display_name / id / phone).
	like := "%" + escapeLike(q) + "%"
	prefix := escapeLike(q) + "%"
	phoneQ, phoneOK := phoneLookupQuery(q)
	phonePrefix := phoneQ + "%"
	rows, err := s.db.Query(r.Context(), `
		SELECT id::text, username, display_name, avatar_url, friend_privacy
		FROM users
		WHERE banned=FALSE
		  AND enterprise_id IS NOT DISTINCT FROM $1
		  AND (
		    id::text = $2
		    OR username ILIKE $3 ESCAPE '\'
		    OR username ILIKE $4 ESCAPE '\'
		    OR display_name ILIKE $4 ESCAPE '\'
		    OR ($5 AND phone = $6)
		    OR ($5 AND length($6) >= 3 AND phone LIKE $7)
		  )
		ORDER BY
		  CASE WHEN $5 AND phone = $6 THEN 0
		       WHEN lower(username) = lower($2) THEN 1
		       WHEN username ILIKE $3 ESCAPE '\' THEN 2
		       ELSE 3 END,
		  username
		LIMIT 20`, entArg(c.EnterpriseID), q, prefix, like, phoneOK, phoneQ, phonePrefix)
	if err != nil {
		writeErrCode(w, 500, "query_failed", "query failed")
		return
	}
	defer rows.Close()
	var users []map[string]any
	for rows.Next() {
		var id, uname, dname, avatar, privacy string
		_ = rows.Scan(&id, &uname, &dname, &avatar, &privacy)
		if id == c.UserID {
			continue
		}
		users = append(users, map[string]any{
			"id": id, "username": uname, "display_name": dname,
			"avatar_url": avatar, "friend_privacy": privacy,
		})
	}
	if users == nil {
		users = []map[string]any{}
	}
	writeJSON(w, 200, map[string]any{"users": users})
}

// phoneLookupQuery returns digit-only phone text when q is a phone-shaped query
// (digits with optional spaces/dashes/parentheses only).
func phoneLookupQuery(q string) (digits string, ok bool) {
	var b strings.Builder
	for _, r := range q {
		switch {
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == ' ' || r == '-' || r == '(' || r == ')':
			// ignore common phone separators
		default:
			return "", false
		}
	}
	digits = b.String()
	if digits == "" {
		return "", false
	}
	return digits, true
}

// handleGetUser returns another user's profile (user profile / popover).
// Respects profile_visibility: public | friends. Phone is never exposed.
func (s *Server) handleGetUser(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	targetID := strings.TrimSpace(r.PathValue("id"))
	if targetID == "" {
		writeErrCode(w, 400, "invalid_request", "user id required")
		return
	}
	if targetID == c.UserID {
		s.handleMe(w, r)
		return
	}

	var username, display, realName, region, sig, avatar, vis, fp string
	var age *int
	var lastActive *time.Time
	var banned bool
	err := s.db.QueryRow(r.Context(), `
		SELECT username, display_name, COALESCE(real_name,''), age, COALESCE(region,''),
		       COALESCE(signature,''), COALESCE(avatar_url,''),
		       COALESCE(profile_visibility,'friends'), COALESCE(friend_privacy,'approval'),
		       banned, last_active_at
		FROM users
		WHERE id=$1 AND banned=FALSE
		  AND enterprise_id IS NOT DISTINCT FROM $2`, targetID, entArg(c.EnterpriseID)).
		Scan(&username, &display, &realName, &age, &region, &sig, &avatar, &vis, &fp, &banned, &lastActive)
	if err != nil || banned {
		writeErrCode(w, 404, "not_found", "user not found")
		return
	}

	var friendshipID, friendshipStatus string
	_ = s.db.QueryRow(r.Context(), `
		SELECT id::text, status FROM friendships
		WHERE ((requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1))
		ORDER BY created_at DESC LIMIT 1`, c.UserID, targetID).
		Scan(&friendshipID, &friendshipStatus)

	isFriend := friendshipStatus == "accepted"
	canViewFull := vis == "public" || isFriend

	var note string
	var tags []string
	if friendshipID != "" {
		_ = s.db.QueryRow(r.Context(), `
			SELECT COALESCE(note,''), COALESCE(tags, '{}')
			FROM friendship_user_preferences
			WHERE friendship_id=$1 AND user_id=$2`, friendshipID, c.UserID).Scan(&note, &tags)
	}
	if tags == nil {
		tags = []string{}
	}

	out := map[string]any{
		"id":                targetID,
		"username":          username,
		"display_name":      display,
		"avatar_url":        avatar,
		"friend_privacy":    fp,
		"profile_visibility": vis,
		"friendship_id":     friendshipID,
		"friendship_status": friendshipStatus,
		"is_friend":         isFriend,
		"online":            s.hub.OnlineUserIDs([]string{targetID})[targetID],
		"note":              note,
		"tags":              tags,
	}
	if lastActive != nil {
		out["last_active_at"] = lastActive.UTC()
	}
	if canViewFull {
		out["real_name"] = realName
		out["age"] = age
		out["region"] = region
		out["signature"] = sig
	}
	writeJSON(w, 200, out)
}

func (s *Server) friendshipBlocked(r *http.Request, a, b, ent string) bool {
	var blocked bool
	_ = s.db.QueryRow(r.Context(), `
		SELECT EXISTS(
			SELECT 1 FROM friendships
			WHERE status='blocked'
			  AND ((requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1))
		)`, a, b).Scan(&blocked)
	return blocked
}

// canInviteUserToGroup allows group invites without friendship.
// Target must exist, not be banned, not be blocked either way, and share the same enterprise.
func (s *Server) canInviteUserToGroup(r *http.Request, inviterID, targetID, enterpriseID string) bool {
	if targetID == "" || targetID == inviterID || strings.TrimSpace(enterpriseID) == "" {
		return false
	}
	if s.friendshipBlocked(r, inviterID, targetID, enterpriseID) {
		return false
	}
	var ok bool
	_ = s.db.QueryRow(r.Context(), `
		SELECT EXISTS(
			SELECT 1 FROM users
			WHERE id=$1 AND banned=FALSE
			  AND enterprise_id IS NOT DISTINCT FROM $2
		)`, targetID, entArg(enterpriseID)).Scan(&ok)
	return ok
}

// ensureDMConversation returns the existing DM between the two users or creates one.
func (s *Server) ensureDMConversation(r *http.Request, userID, peerID string, ent any) (string, error) {
	var convID string
	err := s.db.QueryRow(r.Context(), `
		SELECT c.id::text FROM conversations c
		JOIN conversation_members a ON a.conversation_id=c.id AND a.user_id=$1
		JOIN conversation_members b ON b.conversation_id=c.id AND b.user_id=$2
		WHERE c.type='dm' LIMIT 1`, userID, peerID).Scan(&convID)
	if err == nil {
		return convID, nil
	}
	id := uuid.New()
	_, err = s.db.Exec(r.Context(), `
		INSERT INTO conversations(id, enterprise_id, type, title, owner_id)
		VALUES ($1,$2,'dm','',$3)`, id, ent, userID)
	if err != nil {
		return "", err
	}
	_, err = s.db.Exec(r.Context(), `
		INSERT INTO conversation_members(conversation_id, user_id, role, history_visible_from)
		VALUES ($1,$2,'member', now()), ($1,$3,'member', now())`, id, userID, peerID)
	if err != nil {
		return "", err
	}
	return id.String(), nil
}

// sendGreetingMessage inserts the auto "Hi" into the DM and broadcasts message.new.
func (s *Server) sendGreetingMessage(r *http.Request, convID, senderID, body string, ent any) {
	var msgID string
	var seq int64
	err := s.db.QueryRow(r.Context(), `
		INSERT INTO messages(id, conversation_id, enterprise_id, sender_id, client_msg_id, type, body)
		VALUES ($1,$2,$3,$4,$5,'text',$6)
		RETURNING id::text, seq`,
		uuid.New(), convID, ent, senderID, uuid.NewString(), body).Scan(&msgID, &seq)
	if err != nil {
		return
	}
	var senderName, senderAvatar string
	_ = s.db.QueryRow(r.Context(), `SELECT display_name, avatar_url FROM users WHERE id=$1`, senderID).
		Scan(&senderName, &senderAvatar)
	s.hub.PublishToUsers(s.memberIDs(r, convID), ws.Event{Type: "message.new", Payload: map[string]any{
		"id": msgID, "conversation_id": convID, "sender_id": senderID,
		"seq": seq, "type": "text", "body": body, "created_at": time.Now().UTC(),
		"sender_name": senderName, "sender_avatar": senderAvatar,
	}})
}

func (s *Server) handleFriendRequest(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	var req struct {
		Username string `json:"username"`
		UserID   string `json:"user_id"`
		Message  string `json:"message"`
		Greeting string `json:"greeting"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErrCode(w, 400, "invalid_json", "invalid json")
		return
	}
	ent := entArg(c.EnterpriseID)
	if c.EnterpriseID == "" {
		writeErrCode(w, 403, "no_enterprise", "enterprise required")
		return
	}
	var targetID, privacy string
	var err error
	if req.UserID != "" || req.Username != "" {
		// Same-tenant only.
		if req.UserID != "" {
			err = s.db.QueryRow(r.Context(), `
				SELECT id::text, friend_privacy FROM users
				WHERE banned=FALSE AND id::text = $2
				  AND enterprise_id IS NOT DISTINCT FROM $1::uuid`,
				c.EnterpriseID, strings.TrimSpace(req.UserID)).Scan(&targetID, &privacy)
		}
		if (err != nil || targetID == "") && req.Username != "" {
			err = s.db.QueryRow(r.Context(), `
				SELECT id::text, friend_privacy FROM users
				WHERE banned=FALSE AND lower(username) = lower($2)
				  AND enterprise_id IS NOT DISTINCT FROM $1::uuid`,
				c.EnterpriseID, strings.TrimSpace(req.Username)).Scan(&targetID, &privacy)
		}
	} else {
		writeErrCode(w, 400, "invalid_request", "username or user_id required")
		return
	}
	if err != nil {
		writeErrCode(w, 404, "user_not_found", "user not found")
		return
	}
	if targetID == c.UserID {
		writeErrCode(w, 400, "cannot_add_self", "cannot add self")
		return
	}
	if privacy == "closed" {
		writeErrCode(w, 403, "friend_closed", "user does not accept friend requests")
		return
	}
	if s.friendshipBlocked(r, c.UserID, targetID, c.EnterpriseID) {
		writeErrCode(w, 403, "blocked", "cannot send friend request")
		return
	}
	// JD: group setting forbid_member_friend_add blocks peer adds when both share such a group.
	var groupTitle, ownerName string
	err = s.db.QueryRow(r.Context(), `
		SELECT COALESCE(NULLIF(conv.title, ''), 'Group'),
		       COALESCE(
		         NULLIF((SELECT COALESCE(NULLIF(ou.display_name, ''), ou.username)
		                 FROM users ou WHERE ou.id = conv.owner_id), ''),
		         NULLIF((SELECT COALESCE(NULLIF(ou.display_name, ''), ou.username)
		                 FROM conversation_members om
		                 JOIN users ou ON ou.id = om.user_id
		                 WHERE om.conversation_id = conv.id AND om.role = 'owner'
		                 LIMIT 1), ''),
		         'owner'
		       )
		FROM conversation_members a
		JOIN conversation_members b ON b.conversation_id = a.conversation_id
		JOIN conversations conv ON conv.id = a.conversation_id
		WHERE a.user_id = $1 AND b.user_id = $2
		  AND a.role <> 'pending' AND b.role <> 'pending'
		  AND conv.type = 'social_group' AND conv.forbid_member_friend_add = TRUE
		ORDER BY conv.created_at
		LIMIT 1`, c.UserID, targetID).Scan(&groupTitle, &ownerName)
	if err == nil && groupTitle != "" {
		msg := fmt.Sprintf(
			`Group "%s" (owner: %s) forbids members adding each other as friends`,
			groupTitle, ownerName,
		)
		writeErrFields(w, 403, "group_forbid_friend", msg, map[string]string{
			"group": groupTitle,
			"owner": ownerName,
		})
		return
	}
	// Existing accepted friendship? Reuse the DM without another greeting.
	var existing string
	_ = s.db.QueryRow(r.Context(), `
		SELECT status FROM friendships
		WHERE ((requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1))
		LIMIT 1`, c.UserID, targetID).Scan(&existing)
	if existing == "accepted" {
		convID, _ := s.ensureDMConversation(r, c.UserID, targetID, ent)
		writeJSON(w, 200, map[string]any{"status": "accepted", "conversation_id": convID})
		return
	}
	if existing == "pending" {
		var pendingID string
		_ = s.db.QueryRow(r.Context(), `
			SELECT id::text FROM friendships
			WHERE ((requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1))
			  AND status='pending'
			LIMIT 1`, c.UserID, targetID).Scan(&pendingID)
		writeJSON(w, 200, map[string]any{"id": pendingID, "status": "pending"})
		return
	}
	var count int
	_ = s.db.QueryRow(r.Context(), `
		SELECT COUNT(*) FROM friendships
		WHERE status='accepted' AND (requester_id=$1 OR addressee_id=$1)`, c.UserID).Scan(&count)
	if count >= 1000 {
		writeErrCode(w, 400, "friend_limit", "friend limit reached")
		return
	}
	// Three modes (friend_privacy): open → link immediately; approval → pending
	// until the addressee accepts; closed is rejected above.
	status := "pending"
	if privacy == "open" {
		status = "accepted"
	}
	greeting := strings.TrimSpace(req.Greeting)
	if greeting == "" {
		greeting = strings.TrimSpace(req.Message)
	}
	if greeting == "" {
		greeting = "Hi"
	}
	note := strings.TrimSpace(req.Message)
	if note == "" {
		note = greeting
	}
	id := uuid.New()
	// Prefer updating either direction row if it exists.
	tag, err := s.db.Exec(r.Context(), `
		UPDATE friendships SET status=$3, note=$4, requester_id=$1, addressee_id=$2
		WHERE ((requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1))
		  AND status IN ('pending','rejected')`,
		c.UserID, targetID, status, note)
	if err != nil {
		writeErrCode(w, 400, "request_failed", "request failed")
		return
	}
	if tag.RowsAffected() == 0 {
		_, err = s.db.Exec(r.Context(), `
			INSERT INTO friendships(id, enterprise_id, requester_id, addressee_id, status, note)
			VALUES ($1,$2,$3,$4,$5,$6)
			ON CONFLICT (requester_id, addressee_id) DO UPDATE SET status=EXCLUDED.status, note=EXCLUDED.note`,
			id, ent, c.UserID, targetID, status, note)
		if err != nil {
			writeErrCode(w, 400, "request_failed", "request failed")
			return
		}
	} else {
		_ = s.db.QueryRow(r.Context(), `
			SELECT id FROM friendships
			WHERE ((requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1))
			LIMIT 1`, c.UserID, targetID).Scan(&id)
	}
	payload := map[string]any{
		"from":          c.UserID,
		"status":        status,
		"id":            id.String(),
		"from_name":     s.userDisplayName(r, c.UserID),
		"from_username": "",
	}
	var fromUser string
	_ = s.db.QueryRow(r.Context(), `SELECT username FROM users WHERE id=$1`, c.UserID).Scan(&fromUser)
	payload["from_username"] = fromUser
	resp := map[string]any{"id": id.String(), "status": status}
	if status == "accepted" {
		convID, dmErr := s.ensureDMConversation(r, c.UserID, targetID, ent)
		if dmErr == nil {
			s.sendGreetingMessage(r, convID, c.UserID, greeting, ent)
			payload["conversation_id"] = convID
			resp["conversation_id"] = convID
		}
	}
	s.hub.PublishToUsers([]string{targetID}, ws.Event{Type: "friend.request", Payload: payload})
	if status == "pending" {
		fromName, _ := payload["from_name"].(string)
		s.notifyFriendRequestPush(r.Context(), targetID, fromName, fromUser)
	}
	writeJSON(w, 201, resp)
}

func (s *Server) handleFriendAccept(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	id := r.PathValue("id")
	var requesterID, note string
	var ent any
	err := s.db.QueryRow(r.Context(), `
		SELECT requester_id::text, COALESCE(note,''), enterprise_id
		FROM friendships
		WHERE id=$1 AND addressee_id=$2 AND status='pending'`, id, c.UserID).
		Scan(&requesterID, &note, &ent)
	if err != nil {
		writeErrCode(w, 404, "request_not_found", "request not found")
		return
	}
	tag, err := s.db.Exec(r.Context(), `
		UPDATE friendships SET status='accepted'
		WHERE id=$1 AND addressee_id=$2 AND status='pending'`,
		id, c.UserID)
	if err != nil || tag.RowsAffected() == 0 {
		writeErrCode(w, 404, "request_not_found", "request not found")
		return
	}
	convID, dmErr := s.ensureDMConversation(r, requesterID, c.UserID, ent)
	greeting := strings.TrimSpace(note)
	if greeting == "" {
		greeting = "Hi"
	}
	if dmErr == nil {
		s.sendGreetingMessage(r, convID, requesterID, greeting, ent)
	}
	s.hub.PublishToUsers([]string{requesterID, c.UserID}, ws.Event{Type: "friend.request", Payload: map[string]any{
		"from": requesterID, "status": "accepted", "id": id, "conversation_id": convID,
	}})
	writeJSON(w, 200, map[string]any{"ok": true, "conversation_id": convID})
}

func (s *Server) handleFriendReject(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	id := r.PathValue("id")
	tag, err := s.db.Exec(r.Context(), `
		UPDATE friendships SET status='rejected'
		WHERE id=$1 AND status='pending'
		  AND (addressee_id=$2 OR requester_id=$2)`,
		id, c.UserID)
	if err != nil || tag.RowsAffected() == 0 {
		writeErrCode(w, 404, "request_not_found", "request not found")
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) handleFriendBlock(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	id := strings.TrimSpace(r.PathValue("id"))
	ent := entArg(c.EnterpriseID)
	// id may be friendship_id or peer user_id.
	var peerID string
	err := s.db.QueryRow(r.Context(), `
		SELECT CASE WHEN requester_id=$2 THEN addressee_id ELSE requester_id END::text
		FROM friendships WHERE id=$1
		  AND (requester_id=$2 OR addressee_id=$2)`, id, c.UserID).Scan(&peerID)
	if err != nil {
		peerID = id
		var exists bool
		_ = s.db.QueryRow(r.Context(), `
			SELECT EXISTS(
				SELECT 1 FROM users
				WHERE id=$1 AND banned=FALSE
				  AND enterprise_id IS NOT DISTINCT FROM $2::uuid
			)`, peerID, c.EnterpriseID).Scan(&exists)
		if !exists {
			writeErrCode(w, 404, "not_found", "not found")
			return
		}
		// Prefer updating any existing row either direction, then insert.
		tag, updErr := s.db.Exec(r.Context(), `
			UPDATE friendships SET status='blocked', requester_id=$1, addressee_id=$2
			WHERE ((requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1))`,
			c.UserID, peerID)
		if updErr != nil || tag.RowsAffected() == 0 {
			fid := uuid.New()
			_, err = s.db.Exec(r.Context(), `
				INSERT INTO friendships(id, enterprise_id, requester_id, addressee_id, status)
				VALUES ($1,$2,$3,$4,'blocked')
				ON CONFLICT (requester_id, addressee_id) DO UPDATE SET status='blocked'`,
				fid, ent, c.UserID, peerID)
			if err != nil {
				writeErrCode(w, 400, "block_failed", "block failed")
				return
			}
		}
	} else {
		_, _ = s.db.Exec(r.Context(), `
			UPDATE friendships SET status='blocked', requester_id=$2, addressee_id=$3
			WHERE id=$1`, id, c.UserID, peerID)
	}
	// Both sides drop the DM from their sidebar / stop messaging.
	s.hub.PublishToUsers([]string{c.UserID, peerID}, ws.Event{
		Type: "friend.blocked",
		Payload: map[string]any{
			"from": c.UserID, "peer_id": peerID, "status": "blocked",
		},
	})
	writeJSON(w, 200, map[string]any{"ok": true, "status": "blocked"})
}

func (s *Server) handleFriendUnblock(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	id := r.PathValue("id")
	tag, err := s.db.Exec(r.Context(), `
		UPDATE friendships SET status='rejected'
		WHERE id=$1 AND requester_id=$2 AND status='blocked'`,
		id, c.UserID)
	if err != nil || tag.RowsAffected() == 0 {
		// also allow unblock by peer user id
		tag, err = s.db.Exec(r.Context(), `
			UPDATE friendships SET status='rejected'
			WHERE requester_id=$1 AND addressee_id=$2 AND status='blocked'`,
			c.UserID, id)
		if err != nil || tag.RowsAffected() == 0 {
			writeErrCode(w, 404, "not_found", "not found")
			return
		}
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) handleFriendNote(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	id := r.PathValue("id")
	var req struct {
		Note string   `json:"note"`
		Tags []string `json:"tags"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErrCode(w, 400, "invalid_json", "invalid json")
		return
	}
	if req.Tags == nil {
		req.Tags = []string{}
	}
	// Viewer-scoped alias/tags (preferences), not shared friendship columns.
	var friendshipID string
	err := s.db.QueryRow(r.Context(), `
		SELECT id::text FROM friendships
		WHERE id=$1 AND (requester_id=$2 OR addressee_id=$2) AND status='accepted'`,
		id, c.UserID).Scan(&friendshipID)
	if err != nil || friendshipID == "" {
		writeErrCode(w, 400, "update_failed", "update failed")
		return
	}
	_, err = s.db.Exec(r.Context(), `
		INSERT INTO friendship_user_preferences(friendship_id, user_id, note, tags, updated_at)
		VALUES ($1,$2,$3,$4,now())
		ON CONFLICT (friendship_id, user_id) DO UPDATE SET
			note=EXCLUDED.note,
			tags=EXCLUDED.tags,
			updated_at=now()`,
		friendshipID, c.UserID, req.Note, req.Tags)
	if err != nil {
		writeErrCode(w, 400, "update_failed", "update failed")
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "note": req.Note, "tags": req.Tags})
}
