package server

import (
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/qchat/qchat/services/api/internal/ws"
)

func (s *Server) handleListFriends(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	statusFilter := r.URL.Query().Get("status")
	rows, err := s.db.Query(r.Context(), `
		SELECT f.id::text,
			CASE WHEN f.requester_id=$1 THEN f.addressee_id ELSE f.requester_id END::text,
			u.username, u.display_name, u.avatar_url, f.note, f.tags, f.status,
			(f.addressee_id=$1 AND f.status='pending') AS incoming,
			(f.requester_id=$1) AS outgoing
		FROM friendships f
		JOIN users u ON u.id = CASE WHEN f.requester_id=$1 THEN f.addressee_id ELSE f.requester_id END
		WHERE f.enterprise_id=$2
		  AND (f.requester_id=$1 OR f.addressee_id=$1)
		  AND (
		    ($3 = '' AND f.status IN ('accepted','pending','blocked'))
		    OR f.status = $3
		  )
		ORDER BY f.created_at DESC`, c.UserID, c.EnterpriseID, statusFilter)
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
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		writeErrCode(w, 400, "invalid_request", "q required")
		return
	}
	rows, err := s.db.Query(r.Context(), `
		SELECT id::text, username, display_name, avatar_url, friend_privacy
		FROM users
		WHERE enterprise_id=$1 AND banned=FALSE
		  AND (username = $2 OR id::text = $2)
		LIMIT 5`, c.EnterpriseID, q)
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

func (s *Server) friendshipBlocked(r *http.Request, a, b, ent string) bool {
	var blocked bool
	_ = s.db.QueryRow(r.Context(), `
		SELECT EXISTS(
			SELECT 1 FROM friendships
			WHERE enterprise_id=$1 AND status='blocked'
			  AND ((requester_id=$2 AND addressee_id=$3) OR (requester_id=$3 AND addressee_id=$2))
		)`, ent, a, b).Scan(&blocked)
	return blocked
}

func (s *Server) handleFriendRequest(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	var req struct {
		Username string `json:"username"`
		UserID   string `json:"user_id"`
		Message  string `json:"message"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErrCode(w, 400, "invalid_json", "invalid json")
		return
	}
	var targetID, privacy string
	var err error
	if req.UserID != "" {
		err = s.db.QueryRow(r.Context(), `
			SELECT id::text, friend_privacy FROM users
			WHERE enterprise_id=$1 AND id=$2`, c.EnterpriseID, req.UserID).Scan(&targetID, &privacy)
	} else if req.Username != "" {
		err = s.db.QueryRow(r.Context(), `
			SELECT id::text, friend_privacy FROM users
			WHERE enterprise_id=$1 AND username=$2`, c.EnterpriseID, req.Username).Scan(&targetID, &privacy)
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
	var forbid bool
	_ = s.db.QueryRow(r.Context(), `
		SELECT EXISTS(
			SELECT 1 FROM conversation_members a
			JOIN conversation_members b ON b.conversation_id=a.conversation_id
			JOIN conversations conv ON conv.id=a.conversation_id
			WHERE a.user_id=$1 AND b.user_id=$2
			  AND a.role <> 'pending' AND b.role <> 'pending'
			  AND conv.type='social_group' AND conv.forbid_member_friend_add=TRUE
		)`, c.UserID, targetID).Scan(&forbid)
	if forbid {
		writeErrCode(w, 403, "group_forbid_friend", "group policy forbids adding members as friends")
		return
	}
	// Existing accepted friendship?
	var existing string
	_ = s.db.QueryRow(r.Context(), `
		SELECT status FROM friendships
		WHERE enterprise_id=$1
		  AND ((requester_id=$2 AND addressee_id=$3) OR (requester_id=$3 AND addressee_id=$2))
		LIMIT 1`, c.EnterpriseID, c.UserID, targetID).Scan(&existing)
	if existing == "accepted" {
		writeJSON(w, 200, map[string]any{"status": "accepted"})
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
	status := "pending"
	if privacy == "open" {
		status = "accepted"
	}
	id := uuid.New()
	// Prefer updating either direction row if it exists.
	tag, err := s.db.Exec(r.Context(), `
		UPDATE friendships SET status=$4, note=$5, requester_id=$2, addressee_id=$3
		WHERE enterprise_id=$1
		  AND ((requester_id=$2 AND addressee_id=$3) OR (requester_id=$3 AND addressee_id=$2))
		  AND status IN ('pending','rejected')`,
		c.EnterpriseID, c.UserID, targetID, status, req.Message)
	if err != nil {
		writeErrCode(w, 400, "request_failed", "request failed")
		return
	}
	if tag.RowsAffected() == 0 {
		_, err = s.db.Exec(r.Context(), `
			INSERT INTO friendships(id, enterprise_id, requester_id, addressee_id, status, note)
			VALUES ($1,$2,$3,$4,$5,$6)
			ON CONFLICT (requester_id, addressee_id) DO UPDATE SET status=EXCLUDED.status, note=EXCLUDED.note`,
			id, c.EnterpriseID, c.UserID, targetID, status, req.Message)
		if err != nil {
			writeErrCode(w, 400, "request_failed", "request failed")
			return
		}
	} else {
		_ = s.db.QueryRow(r.Context(), `
			SELECT id::text FROM friendships
			WHERE enterprise_id=$1
			  AND ((requester_id=$2 AND addressee_id=$3) OR (requester_id=$3 AND addressee_id=$2))
			LIMIT 1`, c.EnterpriseID, c.UserID, targetID).Scan(&id)
	}
	s.hub.PublishToUsers([]string{targetID}, ws.Event{Type: "friend.request", Payload: map[string]any{"from": c.UserID, "status": status}})
	writeJSON(w, 201, map[string]any{"id": id.String(), "status": status})
}

func (s *Server) handleFriendAccept(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	id := r.PathValue("id")
	tag, err := s.db.Exec(r.Context(), `
		UPDATE friendships SET status='accepted'
		WHERE id=$1 AND addressee_id=$2 AND enterprise_id=$3 AND status='pending'`, id, c.UserID, c.EnterpriseID)
	if err != nil || tag.RowsAffected() == 0 {
		writeErrCode(w, 404, "request_not_found", "request not found")
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) handleFriendReject(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	id := r.PathValue("id")
	tag, err := s.db.Exec(r.Context(), `
		UPDATE friendships SET status='rejected'
		WHERE id=$1 AND addressee_id=$2 AND enterprise_id=$3 AND status='pending'`, id, c.UserID, c.EnterpriseID)
	if err != nil || tag.RowsAffected() == 0 {
		writeErrCode(w, 404, "request_not_found", "request not found")
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) handleFriendBlock(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	id := r.PathValue("id")
	// id may be friendship_id or user_id
	var peerID string
	err := s.db.QueryRow(r.Context(), `
		SELECT CASE WHEN requester_id=$2 THEN addressee_id ELSE requester_id END::text
		FROM friendships WHERE id=$1 AND enterprise_id=$3
		  AND (requester_id=$2 OR addressee_id=$2)`, id, c.UserID, c.EnterpriseID).Scan(&peerID)
	if err != nil {
		peerID = id
		var exists bool
		_ = s.db.QueryRow(r.Context(), `
			SELECT EXISTS(SELECT 1 FROM users WHERE id=$1 AND enterprise_id=$2)`, peerID, c.EnterpriseID).Scan(&exists)
		if !exists {
			writeErrCode(w, 404, "not_found", "not found")
			return
		}
		fid := uuid.New()
		_, err = s.db.Exec(r.Context(), `
			INSERT INTO friendships(id, enterprise_id, requester_id, addressee_id, status)
			VALUES ($1,$2,$3,$4,'blocked')
			ON CONFLICT (requester_id, addressee_id) DO UPDATE SET status='blocked'`,
			fid, c.EnterpriseID, c.UserID, peerID)
		if err != nil {
			// try reverse direction update
			_, _ = s.db.Exec(r.Context(), `
				UPDATE friendships SET status='blocked', requester_id=$2, addressee_id=$3
				WHERE enterprise_id=$1
				  AND ((requester_id=$2 AND addressee_id=$3) OR (requester_id=$3 AND addressee_id=$2))`,
				c.EnterpriseID, c.UserID, peerID)
		}
		writeJSON(w, 200, map[string]any{"ok": true, "status": "blocked"})
		return
	}
	_, _ = s.db.Exec(r.Context(), `
		UPDATE friendships SET status='blocked', requester_id=$2, addressee_id=$3
		WHERE id=$1`, id, c.UserID, peerID)
	writeJSON(w, 200, map[string]any{"ok": true, "status": "blocked"})
}

func (s *Server) handleFriendUnblock(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	id := r.PathValue("id")
	tag, err := s.db.Exec(r.Context(), `
		UPDATE friendships SET status='rejected'
		WHERE id=$1 AND requester_id=$2 AND enterprise_id=$3 AND status='blocked'`, id, c.UserID, c.EnterpriseID)
	if err != nil || tag.RowsAffected() == 0 {
		// also allow unblock by peer user id
		tag, err = s.db.Exec(r.Context(), `
			UPDATE friendships SET status='rejected'
			WHERE enterprise_id=$1 AND requester_id=$2 AND addressee_id=$3 AND status='blocked'`,
			c.EnterpriseID, c.UserID, id)
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
	tag, err := s.db.Exec(r.Context(), `
		UPDATE friendships SET note=$3, tags=$4
		WHERE id=$1 AND enterprise_id=$5 AND (requester_id=$2 OR addressee_id=$2) AND status='accepted'`,
		id, c.UserID, req.Note, req.Tags, c.EnterpriseID)
	if err != nil || tag.RowsAffected() == 0 {
		writeErrCode(w, 400, "update_failed", "update failed")
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}
