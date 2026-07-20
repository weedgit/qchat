package server

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/qchat/qchat/services/api/internal/ws"
)

func (s *Server) handleListConversations(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	rows, err := s.db.Query(r.Context(), `
		SELECT conv.id::text, conv.type, COALESCE(conv.title, ''), COALESCE(conv.avatar_url, ''),
		       COALESCE(conv.public_id, ''), cm.role, cm.last_read_seq, cm.favorite, cm.muted,
		       COALESCE((SELECT body FROM messages m WHERE m.conversation_id=conv.id AND m.recalled=FALSE
		                 AND m.created_at >= cm.history_visible_from ORDER BY m.seq DESC LIMIT 1), ''),
		       COALESCE((SELECT m.sender_id::text FROM messages m WHERE m.conversation_id=conv.id AND m.recalled=FALSE
		                 AND m.created_at >= cm.history_visible_from ORDER BY m.seq DESC LIMIT 1), ''),
		       COALESCE((SELECT u.display_name FROM messages m JOIN users u ON u.id=m.sender_id
		                 WHERE m.conversation_id=conv.id AND m.recalled=FALSE
		                 AND m.created_at >= cm.history_visible_from ORDER BY m.seq DESC LIMIT 1), ''),
		       COALESCE((SELECT COUNT(*)::bigint FROM messages m WHERE m.conversation_id=conv.id AND m.seq > cm.last_read_seq
		                 AND m.recalled=FALSE AND m.sender_id<>$1 AND m.created_at >= cm.history_visible_from), 0),
		       COALESCE((SELECT COUNT(*)::bigint FROM messages m WHERE m.conversation_id=conv.id AND m.seq > cm.last_read_seq
		                 AND m.recalled=FALSE AND m.sender_id<>$1 AND m.created_at >= cm.history_visible_from
		                 AND (m.mention_all OR $1 = ANY(m.mentions))), 0),
		       COALESCE((SELECT u.id::text FROM conversation_members om
		                 JOIN users u ON u.id=om.user_id
		                 WHERE om.conversation_id=conv.id AND om.user_id<>$1
		                 ORDER BY om.joined_at LIMIT 1), ''),
		       COALESCE((SELECT u.display_name FROM conversation_members om
		                 JOIN users u ON u.id=om.user_id
		                 WHERE om.conversation_id=conv.id AND om.user_id<>$1
		                 ORDER BY om.joined_at LIMIT 1), ''),
		       COALESCE((SELECT u.avatar_url FROM conversation_members om
		                 JOIN users u ON u.id=om.user_id
		                 WHERE om.conversation_id=conv.id AND om.user_id<>$1
		                 ORDER BY om.joined_at LIMIT 1), ''),
		       (SELECT u.last_active_at FROM conversation_members om
		                 JOIN users u ON u.id=om.user_id
		                 WHERE om.conversation_id=conv.id AND om.user_id<>$1
		                 ORDER BY om.joined_at LIMIT 1),
		       (SELECT m.created_at FROM messages m WHERE m.conversation_id=conv.id AND m.recalled=FALSE
		                 AND m.created_at >= cm.history_visible_from ORDER BY m.seq DESC LIMIT 1),
		       conv.pinned_message_id::text,
		       COALESCE((SELECT body FROM messages pm WHERE pm.id=conv.pinned_message_id AND pm.recalled=FALSE), '')
		FROM conversation_members cm
		JOIN conversations conv ON conv.id=cm.conversation_id
		WHERE cm.user_id=$1 AND conv.enterprise_id=$2 AND cm.role <> 'pending'
		ORDER BY cm.favorite DESC, COALESCE(
		  (SELECT m.created_at FROM messages m WHERE m.conversation_id=conv.id ORDER BY m.seq DESC LIMIT 1),
		  conv.created_at
		) DESC`, c.UserID, c.EnterpriseID)
	if err != nil {
		writeErr(w, 500, "query failed")
		return
	}
	defer rows.Close()
	var out []map[string]any
	var peerIDs []string
	for rows.Next() {
		var id, typ, title, avatar, publicID, role, lastBody, lastSenderID, lastSenderName, peerID, peerName, peerAvatar string
		var lastRead, unread, mentionUnread int64
		var favorite, muted bool
		var lastAt, peerLastActive *time.Time
		var pinnedID *string
		var pinnedBody string
		if err := rows.Scan(&id, &typ, &title, &avatar, &publicID, &role, &lastRead, &favorite, &muted, &lastBody, &lastSenderID, &lastSenderName, &unread, &mentionUnread, &peerID, &peerName, &peerAvatar, &peerLastActive, &lastAt, &pinnedID, &pinnedBody); err != nil {
			continue
		}
		if title == "" && typ == "dm" && peerName != "" {
			title = peerName
		}
		if avatar == "" && typ == "dm" && peerAvatar != "" {
			avatar = peerAvatar
		}
		if title == "" {
			title = "Conversation"
		}
		item := map[string]any{
			"id": id, "type": typ, "title": title, "avatar_url": avatar, "public_id": publicID,
			"role": role, "last_read_seq": lastRead, "last_message": lastBody, "unread": unread,
			"unread_count": unread, "mention_count": mentionUnread, "peer_name": peerName,
			"last_message_sender": lastSenderName, "last_message_mine": lastSenderID == c.UserID,
			"favorite": favorite, "muted": muted,
		}
		if peerID != "" {
			item["peer_id"] = peerID
			peerIDs = append(peerIDs, peerID)
		}
		if peerLastActive != nil {
			item["peer_last_active_at"] = peerLastActive.UTC()
		}
		if lastAt != nil {
			item["last_message_at"] = lastAt.UTC()
		}
		if pinnedID != nil && *pinnedID != "" {
			item["pinned_message_id"] = *pinnedID
			item["pinned_message"] = pinnedBody
		}
		out = append(out, item)
	}
	if out == nil {
		out = []map[string]any{}
	}
	online := s.hub.OnlineUserIDs(peerIDs)
	for _, item := range out {
		if pid, ok := item["peer_id"].(string); ok && pid != "" {
			item["peer_online"] = online[pid]
		}
		// Friend note/alias for DMs (Mattermost has no per-viewer friend notes).
		if typ, _ := item["type"].(string); typ == "dm" {
			if pid, ok := item["peer_id"].(string); ok && pid != "" {
				var note, friendshipID string
				var tags []string
				_ = s.db.QueryRow(r.Context(), `
					SELECT f.id::text, COALESCE(f.note,''), COALESCE(f.tags, '{}')
					FROM friendships f
					WHERE f.status='accepted' AND f.enterprise_id=$1
					  AND ((f.requester_id=$2 AND f.addressee_id=$3)
					    OR (f.requester_id=$3 AND f.addressee_id=$2))
					LIMIT 1`, c.EnterpriseID, c.UserID, pid).Scan(&friendshipID, &note, &tags)
				if friendshipID != "" {
					item["friendship_id"] = friendshipID
				}
				if note != "" {
					item["friend_note"] = note
				}
				if len(tags) > 0 {
					item["friend_tags"] = tags
				}
			}
		}
	}
	writeJSON(w, 200, map[string]any{"conversations": out})
}

func (s *Server) handleOpenDM(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	var req struct {
		UserID string `json:"user_id"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	var accepted bool
	_ = s.db.QueryRow(r.Context(), `
		SELECT EXISTS(
			SELECT 1 FROM friendships
			WHERE status='accepted' AND enterprise_id=$1
			  AND ((requester_id=$2 AND addressee_id=$3) OR (requester_id=$3 AND addressee_id=$2))
		)`, c.EnterpriseID, c.UserID, req.UserID).Scan(&accepted)
	if !accepted {
		writeErrCode(w, 403, "not_friends", "not friends")
		return
	}
	if s.friendshipBlocked(r, c.UserID, req.UserID, c.EnterpriseID) {
		writeErrCode(w, 403, "blocked", "cannot message this user")
		return
	}
	// find existing DM
	var convID string
	err := s.db.QueryRow(r.Context(), `
		SELECT c.id::text FROM conversations c
		JOIN conversation_members a ON a.conversation_id=c.id AND a.user_id=$1
		JOIN conversation_members b ON b.conversation_id=c.id AND b.user_id=$2
		WHERE c.type='dm' AND c.enterprise_id=$3 LIMIT 1`, c.UserID, req.UserID, c.EnterpriseID).Scan(&convID)
	if err == nil {
		writeJSON(w, 200, map[string]any{"id": convID})
		return
	}
	id := uuid.New()
	_, err = s.db.Exec(r.Context(), `
		INSERT INTO conversations(id, enterprise_id, type, title, owner_id)
		VALUES ($1,$2,'dm','',$3)`, id, c.EnterpriseID, c.UserID)
	if err != nil {
		writeErr(w, 500, "create failed")
		return
	}
	_, _ = s.db.Exec(r.Context(), `INSERT INTO conversation_members(conversation_id, user_id, role, history_visible_from) VALUES ($1,$2,'member', now()), ($1,$3,'member', now())`,
		id, c.UserID, req.UserID)
	writeJSON(w, 201, map[string]any{"id": id.String()})
}

func (s *Server) handleCreateGroup(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	var req struct {
		Title       string   `json:"title"`
		MemberIDs   []string `json:"member_ids"`
		Description string   `json:"description"`
	}
	if err := decodeJSON(r, &req); err != nil || req.Title == "" {
		writeErrCode(w, 400, "invalid_request", "title required")
		return
	}
	id := uuid.New()
	publicID := "G" + id.String()[:8]
	_, err := s.db.Exec(r.Context(), `
		INSERT INTO conversations(id, enterprise_id, type, title, description, public_id, owner_id)
		VALUES ($1,$2,'social_group',$3,$4,$5,$6)`, id, c.EnterpriseID, req.Title, req.Description, publicID, c.UserID)
	if err != nil {
		writeErrCode(w, 500, "create_failed", "create failed")
		return
	}
	_, _ = s.db.Exec(r.Context(), `
		INSERT INTO conversation_members(conversation_id, user_id, role, history_visible_from)
		VALUES ($1,$2,'owner', TIMESTAMPTZ '1970-01-01')`, id, c.UserID)
	for _, mid := range req.MemberIDs {
		if mid == c.UserID {
			continue
		}
		var ok bool
		_ = s.db.QueryRow(r.Context(), `
			SELECT EXISTS(
				SELECT 1 FROM friendships
				WHERE status='accepted' AND enterprise_id=$1
				  AND ((requester_id=$2 AND addressee_id=$3) OR (requester_id=$3 AND addressee_id=$2))
			)`, c.EnterpriseID, c.UserID, mid).Scan(&ok)
		if !ok {
			continue
		}
		_, _ = s.db.Exec(r.Context(), `
			INSERT INTO conversation_members(conversation_id, user_id, role, history_visible_from)
			VALUES ($1,$2,'member', now()) ON CONFLICT DO NOTHING`, id, mid)
	}
	writeJSON(w, 201, map[string]any{"id": id.String(), "public_id": publicID})
}

func (s *Server) handleGroupDetails(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	convID := r.PathValue("id")
	var title, description, publicID, avatar, role, ownerID string
	var muteAll bool
	err := s.db.QueryRow(r.Context(), `
		SELECT conv.title, conv.description, COALESCE(conv.public_id,''), COALESCE(conv.avatar_url,''),
		       conv.mute_all, cm.role, conv.owner_id::text
		FROM conversations conv
		JOIN conversation_members cm ON cm.conversation_id=conv.id AND cm.user_id=$2
		WHERE conv.id=$1 AND conv.enterprise_id=$3 AND conv.type='social_group' AND cm.role <> 'pending'`,
		convID, c.UserID, c.EnterpriseID).Scan(&title, &description, &publicID, &avatar, &muteAll, &role, &ownerID)
	if err != nil {
		writeErrCode(w, 404, "not_found", "group not found")
		return
	}
	mrows, _ := s.db.Query(r.Context(), `
		SELECT u.id::text, u.username, u.display_name, u.avatar_url, cm.role, cm.mute_until
		FROM conversation_members cm JOIN users u ON u.id=cm.user_id
		WHERE cm.conversation_id=$1 AND cm.role <> 'pending'
		ORDER BY CASE cm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.display_name`, convID)
	var members []map[string]any
	if mrows != nil {
		defer mrows.Close()
		for mrows.Next() {
			var uid, un, dn, av, mrole string
			var muteUntil *time.Time
			_ = mrows.Scan(&uid, &un, &dn, &av, &mrole, &muteUntil)
			item := map[string]any{
				"user_id": uid, "username": un, "display_name": dn, "avatar_url": av, "role": mrole,
			}
			if muteUntil != nil {
				item["mute_until"] = muteUntil.UTC()
			}
			members = append(members, item)
		}
	}
	if members == nil {
		members = []map[string]any{}
	}
	writeJSON(w, 200, map[string]any{
		"id": convID, "title": title, "description": description, "public_id": publicID,
		"avatar_url": avatar, "mute_all": muteAll, "role": role, "owner_id": ownerID, "members": members,
	})
}

// handlePatchGroup mirrors Mattermost patchChannel / setTeamIcon for group metadata.
func (s *Server) handlePatchGroup(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	convID := r.PathValue("id")
	if !s.isGroupAdmin(r, convID, c.UserID) {
		writeErrCode(w, 403, "forbidden", "only owners and admins can edit group")
		return
	}
	var ent, typ string
	err := s.db.QueryRow(r.Context(), `
		SELECT enterprise_id::text, type FROM conversations WHERE id=$1`, convID).Scan(&ent, &typ)
	if err != nil || ent != c.EnterpriseID || typ != "social_group" {
		writeErrCode(w, 404, "not_found", "group not found")
		return
	}
	var req map[string]any
	if err := decodeJSON(r, &req); err != nil {
		writeErrCode(w, 400, "invalid_request", "invalid json")
		return
	}
	_, err = s.db.Exec(r.Context(), `
		UPDATE conversations SET
			title=COALESCE($2, title),
			description=COALESCE($3, description),
			avatar_url=COALESCE($4, avatar_url)
		WHERE id=$1`,
		convID,
		strPtr(req, "title"),
		strPtr(req, "description"),
		strPtr(req, "avatar_url"),
	)
	if err != nil {
		writeErrCode(w, 400, "update_failed", "update failed")
		return
	}
	s.hub.PublishToUsers(s.memberIDs(r, convID), ws.Event{
		Type: "group.updated",
		Payload: map[string]any{
			"conversation_id": convID,
			"title":           req["title"],
			"description":     req["description"],
			"avatar_url":      req["avatar_url"],
		},
	})
	s.handleGroupDetails(w, r)
}

func (s *Server) handleGroupPending(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	convID := r.PathValue("id")
	if !s.isGroupAdmin(r, convID, c.UserID) {
		writeErrCode(w, 403, "forbidden", "forbidden")
		return
	}
	var ent string
	_ = s.db.QueryRow(r.Context(), `SELECT enterprise_id::text FROM conversations WHERE id=$1`, convID).Scan(&ent)
	if ent != c.EnterpriseID {
		writeErrCode(w, 403, "forbidden", "forbidden")
		return
	}
	rows, err := s.db.Query(r.Context(), `
		SELECT u.id::text, u.username, u.display_name, u.avatar_url, cm.joined_at
		FROM conversation_members cm JOIN users u ON u.id=cm.user_id
		WHERE cm.conversation_id=$1 AND cm.role='pending'
		ORDER BY cm.joined_at`, convID)
	if err != nil {
		writeErrCode(w, 500, "query_failed", "query failed")
		return
	}
	defer rows.Close()
	var pending []map[string]any
	for rows.Next() {
		var uid, un, dn, av string
		var joined time.Time
		_ = rows.Scan(&uid, &un, &dn, &av, &joined)
		pending = append(pending, map[string]any{
			"user_id": uid, "username": un, "display_name": dn, "avatar_url": av, "requested_at": joined.UTC(),
		})
	}
	if pending == nil {
		pending = []map[string]any{}
	}
	writeJSON(w, 200, map[string]any{"pending": pending})
}

func (s *Server) handleAppointAdmin(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	convID := r.PathValue("id")
	var req struct {
		UserID string `json:"user_id"`
		Role   string `json:"role"` // admin|member
	}
	if err := decodeJSON(r, &req); err != nil || req.UserID == "" {
		writeErrCode(w, 400, "invalid_request", "user_id required")
		return
	}
	if s.memberRole(r, convID, c.UserID) != "owner" {
		writeErrCode(w, 403, "forbidden", "only owner can appoint admins")
		return
	}
	if req.Role == "" {
		req.Role = "admin"
	}
	if req.Role != "admin" && req.Role != "member" {
		writeErrCode(w, 400, "invalid_role", "role must be admin or member")
		return
	}
	tag, err := s.db.Exec(r.Context(), `
		UPDATE conversation_members SET role=$3
		WHERE conversation_id=$1 AND user_id=$2 AND role IN ('member','admin')`, convID, req.UserID, req.Role)
	if err != nil || tag.RowsAffected() == 0 {
		writeErrCode(w, 404, "not_found", "member not found")
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "role": req.Role})
}

func (s *Server) handleJoinGroup(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	var req struct {
		PublicID string `json:"public_id"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	var convID, owner string
	err := s.db.QueryRow(r.Context(), `
		SELECT id::text, owner_id::text FROM conversations
		WHERE public_id=$1 AND enterprise_id=$2 AND type='social_group'`, req.PublicID, c.EnterpriseID).
		Scan(&convID, &owner)
	if err != nil {
		writeErr(w, 404, "group not found")
		return
	}
	// Pending membership stored with role=pending via temporary approach: use mute_until far past + role member not inserted
	// For MVP: insert as pending using role 'pending'
	_, err = s.db.Exec(r.Context(), `
		INSERT INTO conversation_members(conversation_id, user_id, role, history_visible_from)
		VALUES ($1,$2,'pending', now()) ON CONFLICT DO NOTHING`, convID, c.UserID)
	if err != nil {
		writeErr(w, 400, "join failed")
		return
	}
	s.hub.PublishToUsers([]string{owner}, ws.Event{Type: "group.join_request", Payload: map[string]any{"conversation_id": convID, "user_id": c.UserID}})
	writeJSON(w, 202, map[string]any{"status": "pending_approval"})
}

func (s *Server) handleApproveJoin(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	convID := r.PathValue("id")
	var req struct {
		UserID string `json:"user_id"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	if !s.isGroupAdmin(r, convID, c.UserID) {
		writeErr(w, 403, "forbidden")
		return
	}
	_, err := s.db.Exec(r.Context(), `
		UPDATE conversation_members SET role='member', history_visible_from=now(), joined_at=now()
		WHERE conversation_id=$1 AND user_id=$2 AND role='pending'`, convID, req.UserID)
	if err != nil {
		writeErr(w, 400, "approve failed")
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) handleMuteMember(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	convID := r.PathValue("id")
	var req struct {
		UserID   string `json:"user_id"`
		Duration string `json:"duration"` // 10m|1h|permanent|all
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	if !s.isGroupAdmin(r, convID, c.UserID) {
		writeErr(w, 403, "forbidden")
		return
	}
	if req.Duration == "all" {
		_, _ = s.db.Exec(r.Context(), `UPDATE conversations SET mute_all=TRUE WHERE id=$1`, convID)
		writeJSON(w, 200, map[string]any{"mute_all": true})
		return
	}
	var until *time.Time
	switch req.Duration {
	case "10m":
		t := time.Now().Add(10 * time.Minute)
		until = &t
	case "1h":
		t := time.Now().Add(time.Hour)
		until = &t
	case "permanent":
		t := time.Date(9999, 1, 1, 0, 0, 0, 0, time.UTC)
		until = &t
	default:
		writeErr(w, 400, "invalid duration")
		return
	}
	_, err := s.db.Exec(r.Context(), `UPDATE conversation_members SET mute_until=$3 WHERE conversation_id=$1 AND user_id=$2`, convID, req.UserID, until)
	if err != nil {
		writeErr(w, 400, "mute failed")
		return
	}
	writeJSON(w, 200, map[string]any{"mute_until": until})
}

func (s *Server) handleListMessages(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	convID := r.PathValue("id")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	var histFrom time.Time
	var role, convType string
	err := s.db.QueryRow(r.Context(), `
		SELECT cm.history_visible_from, cm.role, conv.type
		FROM conversation_members cm
		JOIN conversations conv ON conv.id=cm.conversation_id
		WHERE cm.conversation_id=$1 AND cm.user_id=$2 AND conv.enterprise_id=$3`,
		convID, c.UserID, c.EnterpriseID).Scan(&histFrom, &role, &convType)
	if err != nil || role == "pending" {
		writeErrCode(w, 403, "not_a_member", "not a member")
		return
	}
	isAdmin := role == "owner" || role == "admin"
	// Groups: ordinary members never see recalled messages or notices.
	// DMs: participants see an explicit recall notice.
	showRecalled := convType == "dm" || isAdmin
	rows, err := s.db.Query(r.Context(), `
		SELECT m.id::text, m.sender_id::text, m.client_msg_id, m.seq, m.type,
		       CASE
		         WHEN m.recalled AND NOT $4 THEN ''
		         ELSE m.body
		       END,
		       m.media_url, m.reply_to_id::text, m.mention_all, m.recalled, m.created_at,
		       u.display_name, m.edited_at
		FROM messages m JOIN users u ON u.id=m.sender_id
		WHERE m.conversation_id=$1 AND m.created_at >= $2
		  AND ($3 OR m.recalled=FALSE)
		ORDER BY m.seq DESC LIMIT $5`, convID, histFrom, showRecalled, isAdmin, limit)
	if err != nil {
		writeErrCode(w, 500, "query_failed", "query failed")
		return
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, sid, cmid, typ, body, media, reply, dname string
		var seq int64
		var mentionAll, recalled bool
		var created time.Time
		var editedAt *time.Time
		var replyPtr *string
		_ = rows.Scan(&id, &sid, &cmid, &seq, &typ, &body, &media, &replyPtr, &mentionAll, &recalled, &created, &dname, &editedAt)
		if replyPtr != nil {
			reply = *replyPtr
		}
		item := map[string]any{
			"id": id, "sender_id": sid, "client_msg_id": cmid, "seq": seq, "type": typ,
			"body": body, "media_url": media, "reply_to_id": reply, "mention_all": mentionAll,
			"recalled": recalled, "created_at": created, "sender_name": dname,
			"conversation_id": convID,
		}
		if editedAt != nil {
			item["edited_at"] = editedAt.UTC()
		}
		out = append(out, item)
	}
	if out == nil {
		out = []map[string]any{}
	}
	// reverse to chronological
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	s.attachReactions(r, out, c.UserID)
	writeJSON(w, 200, map[string]any{"messages": out})
}

// attachReactions adds a "reactions" array to each message map:
// [{emoji, count, mine, users:[{id,name,avatar_url}]}] aggregated across users.
func (s *Server) attachReactions(r *http.Request, msgs []map[string]any, userID string) {
	if len(msgs) == 0 {
		return
	}
	ids := make([]string, 0, len(msgs))
	byID := make(map[string]map[string]any, len(msgs))
	for _, m := range msgs {
		id, _ := m["id"].(string)
		if id == "" {
			continue
		}
		ids = append(ids, id)
		byID[id] = m
		m["reactions"] = []map[string]any{}
	}
	rows, err := s.db.Query(r.Context(), `
		SELECT mr.message_id::text, mr.emoji, COUNT(*)::bigint,
		       BOOL_OR(mr.user_id=$2) AS mine,
		       COALESCE(json_agg(json_build_object(
		           'id', u.id::text, 'name', u.display_name, 'avatar_url', u.avatar_url
		       ) ORDER BY mr.created_at), '[]')
		FROM message_reactions mr
		JOIN users u ON u.id = mr.user_id
		WHERE mr.message_id = ANY($1::uuid[])
		GROUP BY mr.message_id, mr.emoji
		ORDER BY MIN(mr.created_at)`, ids, userID)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var mid, emoji string
		var count int64
		var mine bool
		var usersJSON []byte
		if err := rows.Scan(&mid, &emoji, &count, &mine, &usersJSON); err != nil {
			continue
		}
		m := byID[mid]
		if m == nil {
			continue
		}
		var users []map[string]any
		_ = json.Unmarshal(usersJSON, &users)
		list, _ := m["reactions"].([]map[string]any)
		m["reactions"] = append(list, map[string]any{
			"emoji": emoji, "count": count, "mine": mine, "users": users,
		})
	}
}

var allowedReactions = map[string]bool{
	"\u2764\ufe0f": true, // ❤️
	"\U0001F44D":   true, // 👍
	"\U0001F44E":   true, // 👎
	"\U0001F525":   true, // 🔥
	"\U0001F970":   true, // 🥰
	"\U0001F44F":   true, // 👏
	"\U0001F602":   true, // 😂
	"\U0001F62E":   true, // 😮
}

func (s *Server) handleReact(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	msgID := r.PathValue("id")
	var req struct {
		Emoji string `json:"emoji"`
	}
	if err := decodeJSON(r, &req); err != nil || req.Emoji == "" {
		writeErrCode(w, 400, "invalid_request", "emoji required")
		return
	}
	if !allowedReactions[req.Emoji] {
		writeErrCode(w, 400, "invalid_emoji", "unsupported emoji")
		return
	}
	var convID, enterpriseID string
	var recalled bool
	err := s.db.QueryRow(r.Context(), `
		SELECT m.conversation_id::text, conv.enterprise_id::text, m.recalled
		FROM messages m JOIN conversations conv ON conv.id=m.conversation_id
		WHERE m.id=$1`, msgID).Scan(&convID, &enterpriseID, &recalled)
	if err != nil {
		writeErrCode(w, 404, "not_found", "not found")
		return
	}
	role := s.memberRole(r, convID, c.UserID)
	if enterpriseID != c.EnterpriseID || role == "" || role == "pending" {
		writeErrCode(w, 403, "forbidden", "forbidden")
		return
	}
	if recalled {
		writeErrCode(w, 400, "recalled", "cannot react to a recalled message")
		return
	}
	// Toggle: delete if present, insert otherwise.
	tag, err := s.db.Exec(r.Context(), `
		DELETE FROM message_reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3`,
		msgID, c.UserID, req.Emoji)
	if err != nil {
		writeErrCode(w, 500, "react_failed", "react failed")
		return
	}
	added := tag.RowsAffected() == 0
	if added {
		if _, err := s.db.Exec(r.Context(), `
			INSERT INTO message_reactions(message_id, user_id, emoji) VALUES ($1,$2,$3)
			ON CONFLICT DO NOTHING`, msgID, c.UserID, req.Emoji); err != nil {
			writeErrCode(w, 500, "react_failed", "react failed")
			return
		}
	}
	var count int64
	_ = s.db.QueryRow(r.Context(), `
		SELECT COUNT(*) FROM message_reactions WHERE message_id=$1 AND emoji=$2`,
		msgID, req.Emoji).Scan(&count)
	var byName, byAvatar string
	_ = s.db.QueryRow(r.Context(), `
		SELECT display_name, avatar_url FROM users WHERE id=$1`,
		c.UserID).Scan(&byName, &byAvatar)
	s.hub.PublishToUsers(s.memberIDs(r, convID), ws.Event{Type: "message.reaction", Payload: map[string]any{
		"id": msgID, "conversation_id": convID, "emoji": req.Emoji,
		"count": count, "by": c.UserID, "added": added,
		"by_name": byName, "by_avatar": byAvatar,
	}})
	writeJSON(w, 200, map[string]any{"emoji": req.Emoji, "count": count, "added": added})
}

func (s *Server) handleSendMessage(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	convID := r.PathValue("id")
	var req struct {
		ClientMsgID string   `json:"client_msg_id"`
		Type        string   `json:"type"`
		Body        string   `json:"body"`
		MediaURL    string   `json:"media_url"`
		ReplyToID   string   `json:"reply_to_id"`
		Mentions    []string `json:"mentions"`
		MentionAll  bool     `json:"mention_all"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	if req.ClientMsgID == "" {
		req.ClientMsgID = uuid.NewString()
	}
	if req.Type == "" {
		req.Type = "text"
	}
	if req.Type == "text" && len([]rune(req.Body)) > 1000 {
		writeErr(w, 400, "message too long")
		return
	}
	var role string
	var muteUntil *time.Time
	var muteAll bool
	err := s.db.QueryRow(r.Context(), `
		SELECT cm.role, cm.mute_until, conv.mute_all
		FROM conversation_members cm JOIN conversations conv ON conv.id=cm.conversation_id
		WHERE cm.conversation_id=$1 AND cm.user_id=$2`, convID, c.UserID).Scan(&role, &muteUntil, &muteAll)
	if err != nil || role == "pending" {
		writeErr(w, 403, "not a member")
		return
	}
	if muteAll && role != "owner" && role != "admin" {
		writeErr(w, 403, "group muted")
		return
	}
	if muteUntil != nil && muteUntil.After(time.Now()) && role != "owner" && role != "admin" {
		writeErr(w, 403, "you are muted")
		return
	}
	// Mattermost-style mention parsing from message text when client omits mentions.
	if req.Type == "text" && len(req.Mentions) == 0 && !req.MentionAll {
		req.Mentions, req.MentionAll = s.parseMentions(r, convID, c.EnterpriseID, req.Body)
	}
	newID := uuid.New()
	var reply any
	if req.ReplyToID != "" {
		reply = req.ReplyToID
	}
	mentionLiteral := "{}"
	if len(req.Mentions) > 0 {
		mentionLiteral = "{" + strings.Join(req.Mentions, ",") + "}"
	}
	var seq int64
	var msgID string
	err = s.db.QueryRow(r.Context(), `
		INSERT INTO messages(id, conversation_id, enterprise_id, sender_id, client_msg_id, type, body, media_url, reply_to_id, mentions, mention_all)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid[],$11)
		ON CONFLICT (conversation_id, client_msg_id) DO UPDATE SET body=EXCLUDED.body
		RETURNING id::text, seq`, newID, convID, c.EnterpriseID, c.UserID, req.ClientMsgID, req.Type, req.Body, req.MediaURL, reply, mentionLiteral, req.MentionAll).Scan(&msgID, &seq)
	if err != nil {
		writeErr(w, 500, "send failed: "+err.Error())
		return
	}
	memberIDs := s.memberIDs(r, convID)
	payload := map[string]any{
		"id": msgID, "conversation_id": convID, "sender_id": c.UserID, "client_msg_id": req.ClientMsgID,
		"seq": seq, "type": req.Type, "body": req.Body, "media_url": req.MediaURL, "created_at": time.Now().UTC(),
		"mentions": req.Mentions, "mention_all": req.MentionAll,
	}
	s.hub.PublishToUsers(memberIDs, ws.Event{Type: "message.new", Payload: payload})
	writeJSON(w, 201, payload)
}

// parseMentions mirrors Mattermost @user / @channel / @all mention extraction.
func (s *Server) parseMentions(r *http.Request, convID, enterpriseID, body string) ([]string, bool) {
	lower := strings.ToLower(body)
	mentionAll := strings.Contains(lower, "@all") || strings.Contains(lower, "@channel") || strings.Contains(lower, "@everyone")
	re := regexp.MustCompile(`@([a-zA-Z0-9_]{2,32})`)
	names := map[string]struct{}{}
	for _, m := range re.FindAllStringSubmatch(body, -1) {
		name := strings.ToLower(m[1])
		if name == "all" || name == "channel" || name == "everyone" {
			mentionAll = true
			continue
		}
		names[name] = struct{}{}
	}
	if len(names) == 0 {
		return nil, mentionAll
	}
	list := make([]string, 0, len(names))
	for n := range names {
		list = append(list, n)
	}
	rows, err := s.db.Query(r.Context(), `
		SELECT u.id::text FROM users u
		JOIN conversation_members cm ON cm.user_id=u.id AND cm.conversation_id=$1 AND cm.role <> 'pending'
		WHERE u.enterprise_id=$2 AND lower(u.username) = ANY($3::text[])`, convID, enterpriseID, list)
	if err != nil {
		return nil, mentionAll
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		_ = rows.Scan(&id)
		ids = append(ids, id)
	}
	return ids, mentionAll
}

func (s *Server) handleRecall(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	msgID := r.PathValue("id")
	var convID, sender, convType, enterpriseID, body string
	err := s.db.QueryRow(r.Context(), `
		SELECT m.conversation_id::text, m.sender_id::text, conv.type, conv.enterprise_id::text, m.body
		FROM messages m JOIN conversations conv ON conv.id=m.conversation_id
		WHERE m.id=$1`, msgID).Scan(&convID, &sender, &convType, &enterpriseID, &body)
	if err != nil {
		writeErrCode(w, 404, "not_found", "not found")
		return
	}
	if enterpriseID != c.EnterpriseID {
		writeErrCode(w, 403, "forbidden", "forbidden")
		return
	}
	memberRole := s.memberRole(r, convID, c.UserID)
	if memberRole == "" || memberRole == "pending" {
		writeErrCode(w, 403, "not_a_member", "not a member")
		return
	}
	admin := memberRole == "owner" || memberRole == "admin"
	if sender != c.UserID && !admin {
		writeErrCode(w, 403, "forbidden", "forbidden")
		return
	}
	_, _ = s.db.Exec(r.Context(), `UPDATE messages SET recalled=TRUE, recalled_by=$2 WHERE id=$1`, msgID, c.UserID)
	payload := map[string]any{"id": msgID, "conversation_id": convID}
	if convType == "dm" {
		// DMs: all participants see an explicit recall notice.
		s.hub.PublishToUsers(s.memberIDs(r, convID), ws.Event{Type: "message.recalled", Payload: payload})
	} else {
		// Groups: owners/admins see notice; ordinary members get silent remove.
		admins := s.adminIDs(r, convID)
		members := s.memberIDs(r, convID)
		adminSet := map[string]bool{}
		for _, id := range admins {
			adminSet[id] = true
		}
		var ordinary []string
		for _, id := range members {
			if !adminSet[id] {
				ordinary = append(ordinary, id)
			}
		}
		adminPayload := map[string]any{"id": msgID, "conversation_id": convID, "body": body}
		s.hub.PublishToUsers(admins, ws.Event{Type: "message.recalled", Payload: adminPayload})
		s.hub.PublishToUsers(ordinary, ws.Event{Type: "message.removed", Payload: payload})
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) handleRead(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	msgID := r.PathValue("id")
	var convID, sender, enterpriseID string
	var seq int64
	err := s.db.QueryRow(r.Context(), `
		SELECT m.conversation_id::text, m.seq, m.sender_id::text, conv.enterprise_id::text
		FROM messages m JOIN conversations conv ON conv.id=m.conversation_id
		WHERE m.id=$1`, msgID).Scan(&convID, &seq, &sender, &enterpriseID)
	if err != nil {
		writeErrCode(w, 404, "not_found", "not found")
		return
	}
	if enterpriseID != c.EnterpriseID || s.memberRole(r, convID, c.UserID) == "" {
		writeErrCode(w, 403, "forbidden", "forbidden")
		return
	}
	_, _ = s.db.Exec(r.Context(), `
		UPDATE conversation_members SET last_read_seq=GREATEST(last_read_seq,$3)
		WHERE conversation_id=$1 AND user_id=$2`, convID, c.UserID, seq)
	_, _ = s.db.Exec(r.Context(), `
		INSERT INTO message_receipts(message_id, user_id, status) VALUES ($1,$2,'read')
		ON CONFLICT DO NOTHING`, msgID, c.UserID)
	s.hub.PublishToUsers([]string{sender}, ws.Event{Type: "message.read", Payload: map[string]any{"id": msgID, "by": c.UserID, "conversation_id": convID}})
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) handleDelivered(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	msgID := r.PathValue("id")
	var convID, sender, enterpriseID string
	err := s.db.QueryRow(r.Context(), `
		SELECT m.conversation_id::text, m.sender_id::text, conv.enterprise_id::text
		FROM messages m JOIN conversations conv ON conv.id=m.conversation_id
		WHERE m.id=$1`, msgID).Scan(&convID, &sender, &enterpriseID)
	if err != nil {
		writeErrCode(w, 404, "not_found", "not found")
		return
	}
	if enterpriseID != c.EnterpriseID || s.memberRole(r, convID, c.UserID) == "" {
		writeErrCode(w, 403, "forbidden", "forbidden")
		return
	}
	_, _ = s.db.Exec(r.Context(), `
		INSERT INTO message_receipts(message_id, user_id, status) VALUES ($1,$2,'delivered')
		ON CONFLICT DO NOTHING`, msgID, c.UserID)
	s.hub.PublishToUsers([]string{sender}, ws.Event{Type: "message.delivered", Payload: map[string]any{"id": msgID, "by": c.UserID, "conversation_id": convID}})
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) handleForward(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	msgID := r.PathValue("id")
	var req struct {
		ConversationIDs []string `json:"conversation_ids"`
	}
	if err := decodeJSON(r, &req); err != nil || len(req.ConversationIDs) == 0 {
		writeErrCode(w, 400, "invalid_request", "conversation_ids required")
		return
	}
	var typ, body, media, srcConv, enterpriseID string
	err := s.db.QueryRow(r.Context(), `
		SELECT m.type, m.body, m.media_url, m.conversation_id::text, conv.enterprise_id::text
		FROM messages m JOIN conversations conv ON conv.id=m.conversation_id
		WHERE m.id=$1 AND m.recalled=FALSE`, msgID).Scan(&typ, &body, &media, &srcConv, &enterpriseID)
	if err != nil {
		writeErrCode(w, 404, "not_found", "not found")
		return
	}
	if enterpriseID != c.EnterpriseID || s.memberRole(r, srcConv, c.UserID) == "" {
		writeErrCode(w, 403, "forbidden", "forbidden")
		return
	}
	var created []string
	for _, cid := range req.ConversationIDs {
		role := s.memberRole(r, cid, c.UserID)
		if role == "" || role == "pending" {
			continue
		}
		var destEnt string
		_ = s.db.QueryRow(r.Context(), `SELECT enterprise_id::text FROM conversations WHERE id=$1`, cid).Scan(&destEnt)
		if destEnt != c.EnterpriseID {
			continue
		}
		id := uuid.New()
		_, err := s.db.Exec(r.Context(), `
			INSERT INTO messages(id, conversation_id, enterprise_id, sender_id, client_msg_id, type, body, media_url, forwarded_from)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
			id, cid, c.EnterpriseID, c.UserID, uuid.NewString(), typ, body, media, msgID)
		if err == nil {
			created = append(created, id.String())
			s.hub.PublishToUsers(s.memberIDs(r, cid), ws.Event{Type: "message.new", Payload: map[string]any{
				"id": id.String(), "conversation_id": cid, "body": body, "sender_id": c.UserID, "type": typ,
			}})
		}
	}
	writeJSON(w, 201, map[string]any{"forwarded": created})
}

func (s *Server) memberRole(r *http.Request, convID, userID string) string {
	var role string
	_ = s.db.QueryRow(r.Context(), `SELECT role FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`, convID, userID).Scan(&role)
	return role
}

func (s *Server) isGroupAdmin(r *http.Request, convID, userID string) bool {
	role := s.memberRole(r, convID, userID)
	return role == "owner" || role == "admin"
}

func (s *Server) memberIDs(r *http.Request, convID string) []string {
	rows, err := s.db.Query(r.Context(), `SELECT user_id::text FROM conversation_members WHERE conversation_id=$1 AND role <> 'pending'`, convID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		_ = rows.Scan(&id)
		ids = append(ids, id)
	}
	return ids
}

func (s *Server) adminIDs(r *http.Request, convID string) []string {
	rows, err := s.db.Query(r.Context(), `SELECT user_id::text FROM conversation_members WHERE conversation_id=$1 AND role IN ('owner','admin')`, convID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		_ = rows.Scan(&id)
		ids = append(ids, id)
	}
	return ids
}
