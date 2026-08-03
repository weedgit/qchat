package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
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
		                 AND m.created_at >= cm.history_visible_from
		                 AND (m.type <> 'system' OR cm.role IN ('owner','admin'))
		                 ORDER BY m.seq DESC LIMIT 1), ''),
		       COALESCE((SELECT m.sender_id::text FROM messages m WHERE m.conversation_id=conv.id AND m.recalled=FALSE
		                 AND m.created_at >= cm.history_visible_from
		                 AND (m.type <> 'system' OR cm.role IN ('owner','admin'))
		                 ORDER BY m.seq DESC LIMIT 1), ''),
		       COALESCE((SELECT u.display_name FROM messages m JOIN users u ON u.id=m.sender_id
		                 WHERE m.conversation_id=conv.id AND m.recalled=FALSE
		                 AND m.created_at >= cm.history_visible_from
		                 AND (m.type <> 'system' OR cm.role IN ('owner','admin'))
		                 ORDER BY m.seq DESC LIMIT 1), ''),
		       COALESCE((SELECT COUNT(*)::bigint FROM messages m WHERE m.conversation_id=conv.id AND m.seq > cm.last_read_seq
		                 AND m.recalled=FALSE AND m.sender_id<>$1 AND m.created_at >= cm.history_visible_from
		                 AND (m.type <> 'system' OR cm.role IN ('owner','admin'))), 0),
		       COALESCE((SELECT COUNT(*)::bigint FROM messages m WHERE m.conversation_id=conv.id AND m.seq > cm.last_read_seq
		                 AND m.recalled=FALSE AND m.sender_id<>$1 AND m.created_at >= cm.history_visible_from
		                 AND (m.type <> 'system' OR cm.role IN ('owner','admin'))
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
		                 AND m.created_at >= cm.history_visible_from
		                 AND (m.type <> 'system' OR cm.role IN ('owner','admin'))
		                 ORDER BY m.seq DESC LIMIT 1),
		       conv.pinned_message_id::text,
		       COALESCE(
		         NULLIF((SELECT body FROM messages pm WHERE pm.id=conv.pinned_message_id AND pm.recalled=FALSE), ''),
		         CASE (SELECT type FROM messages pm WHERE pm.id=conv.pinned_message_id AND pm.recalled=FALSE)
		           WHEN 'image' THEN 'Photo'
		           WHEN 'voice' THEN 'Voice message'
		           WHEN 'file' THEN 'File'
		           ELSE ''
		         END,
		         ''
		       ),
		       COALESCE(conv.is_enterprise_default, FALSE),
		       COALESCE(e.name, '')
		FROM conversation_members cm
		JOIN conversations conv ON conv.id=cm.conversation_id
		LEFT JOIN enterprises e ON e.id = conv.enterprise_id
		WHERE cm.user_id=$1 AND (
		  cm.role <> 'pending'
		  OR conv.type IN ('social_group', 'group')
		)
		ORDER BY cm.favorite DESC, COALESCE(
		  (SELECT m.created_at FROM messages m WHERE m.conversation_id=conv.id ORDER BY m.seq DESC LIMIT 1),
		  conv.created_at
		) DESC`, c.UserID)
	if err != nil {
		writeErr(w, 500, "query failed")
		return
	}
	defer rows.Close()
	var out []map[string]any
	var peerIDs []string
	for rows.Next() {
		var id, typ, title, avatar, publicID, role, lastBody, lastSenderID, lastSenderName, peerID, peerName, peerAvatar, enterpriseName string
		var lastRead, unread, mentionUnread int64
		var favorite, muted, isEnterpriseDefault bool
		var lastAt, peerLastActive *time.Time
		var pinnedID *string
		var pinnedBody string
		if err := rows.Scan(&id, &typ, &title, &avatar, &publicID, &role, &lastRead, &favorite, &muted, &lastBody, &lastSenderID, &lastSenderName, &unread, &mentionUnread, &peerID, &peerName, &peerAvatar, &peerLastActive, &lastAt, &pinnedID, &pinnedBody, &isEnterpriseDefault, &enterpriseName); err != nil {
			continue
		}
		// Hide DMs with a blocked peer from both sides.
		if typ == "dm" && peerID != "" && s.friendshipBlocked(r, c.UserID, peerID, c.EnterpriseID) {
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
			"is_enterprise_default": isEnterpriseDefault,
			"enterprise_name":      enterpriseName,
		}
		// Pending joiners must not see message previews or unread until approved.
		if role == "pending" {
			item["last_message"] = ""
			item["last_message_sender"] = ""
			item["last_message_mine"] = false
			item["unread"] = 0
			item["unread_count"] = 0
			item["mention_count"] = 0
			delete(item, "last_message_at")
			delete(item, "pinned_message_id")
			delete(item, "pinned_message")
		}
		if peerID != "" {
			item["peer_id"] = peerID
			peerIDs = append(peerIDs, peerID)
		}
		if peerLastActive != nil {
			item["peer_last_active_at"] = peerLastActive.UTC()
		}
		if lastAt != nil && role != "pending" {
			item["last_message_at"] = lastAt.UTC()
		}
		if pinnedID != nil && *pinnedID != "" && role != "pending" {
			item["pinned_message_id"] = *pinnedID
			item["pinned_message"] = pinnedBody
		}
		out = append(out, item)
	}
	if out == nil {
		out = []map[string]any{}
	}
	convIDs := make([]string, 0, len(out))
	for _, item := range out {
		convIDs = append(convIDs, fmt.Sprint(item["id"]))
	}
	pinsByConv := s.loadPinsForConversations(r.Context(), convIDs, c.UserID)
	for _, item := range out {
		id := fmt.Sprint(item["id"])
		pins := pinsByConv[id]
		if pins == nil {
			pins = []map[string]any{}
		}
		item["pinned_messages"] = pins
		if len(pins) > 0 {
			// Prefer chronologically last pin (bottom of chat) for legacy fields.
			last := pins[len(pins)-1]
			item["pinned_message_id"] = last["id"]
			item["pinned_message"] = last["body"]
		} else {
			delete(item, "pinned_message_id")
			delete(item, "pinned_message")
		}
	}
	online := s.hub.OnlineUserIDs(peerIDs)
	for _, item := range out {
		if pid, ok := item["peer_id"].(string); ok && pid != "" {
			item["peer_online"] = online[pid]
		}
		// Per-viewer friend alias for DMs (preferences).
		if typ, _ := item["type"].(string); typ == "dm" {
			if pid, ok := item["peer_id"].(string); ok && pid != "" {
				var note, friendshipID string
				var tags []string
				_ = s.db.QueryRow(r.Context(), `
					SELECT f.id::text, COALESCE(p.note,''), COALESCE(p.tags, '{}')
					FROM friendships f
					LEFT JOIN friendship_user_preferences p
					  ON p.friendship_id = f.id AND p.user_id = $1
					WHERE f.status='accepted'
					  AND ((f.requester_id=$1 AND f.addressee_id=$2)
					    OR (f.requester_id=$2 AND f.addressee_id=$1))
					LIMIT 1`, c.UserID, pid).Scan(&friendshipID, &note, &tags)
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
	ent := entArg(c.EnterpriseID)
	var accepted bool
	_ = s.db.QueryRow(r.Context(), `
		SELECT EXISTS(
			SELECT 1 FROM friendships
			WHERE status='accepted'
			  AND ((requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1))
		)`, c.UserID, req.UserID).Scan(&accepted)
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
		WHERE c.type='dm' LIMIT 1`, c.UserID, req.UserID).Scan(&convID)
	if err == nil {
		writeJSON(w, 200, map[string]any{"id": convID})
		return
	}
	id := uuid.New()
	_, err = s.db.Exec(r.Context(), `
		INSERT INTO conversations(id, enterprise_id, type, title, owner_id)
		VALUES ($1,$2,'dm','',$3)`, id, ent, c.UserID)
	if err != nil {
		writeErr(w, 500, "create failed")
		return
	}
	_, _ = s.db.Exec(r.Context(), `INSERT INTO conversation_members(conversation_id, user_id, role, history_visible_from) VALUES ($1,$2,'member', now()), ($1,$3,'member', now())`,
		id, c.UserID, req.UserID)
	writeJSON(w, 201, map[string]any{"id": id.String()})
}

// maxSocialGroupMembers is the soft capacity for social groups. Requirements
// call for support of more than 1,000 members; 5,000 leaves headroom while
// bounding fan-out and storage cost.
const maxSocialGroupMembers = 5000

func (s *Server) activeGroupMemberCount(r *http.Request, convID string) (int, error) {
	var n int
	err := s.db.QueryRow(r.Context(), `
		SELECT COUNT(*) FROM conversation_members
		WHERE conversation_id=$1 AND role <> 'pending'`, convID).Scan(&n)
	return n, err
}

func (s *Server) handleCreateGroup(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	var req struct {
		Title       string   `json:"title"`
		MemberIDs   []string `json:"member_ids"`
		Description string   `json:"description"`
		AvatarURL   string   `json:"avatar_url"`
	}
	if err := decodeJSON(r, &req); err != nil || req.Title == "" {
		writeErrCode(w, 400, "invalid_request", "title required")
		return
	}
	unique := map[string]struct{}{c.UserID: {}}
	for _, mid := range req.MemberIDs {
		mid = strings.TrimSpace(mid)
		if mid == "" || mid == c.UserID {
			continue
		}
		// Invite any same-tenant user (friendship not required). Skip blocked / unknown.
		if s.canInviteUserToGroup(r, c.UserID, mid, c.EnterpriseID) {
			unique[mid] = struct{}{}
		}
	}
	if len(unique) > maxSocialGroupMembers {
		writeErrCode(w, 400, "group_full", fmt.Sprintf("group member limit is %d", maxSocialGroupMembers))
		return
	}
	id := uuid.New()
	publicID := "G" + id.String()[:8]
	avatarURL := strings.TrimSpace(req.AvatarURL)
	_, err := s.db.Exec(r.Context(), `
		INSERT INTO conversations(id, enterprise_id, type, title, description, public_id, owner_id, avatar_url)
		VALUES ($1,$2,'social_group',$3,$4,$5,$6, COALESCE(NULLIF($7,''), ''))`,
		id, entArg(c.EnterpriseID), req.Title, req.Description, publicID, c.UserID, avatarURL)
	if err != nil {
		log.Printf("create group failed: %v", err)
		writeErrCode(w, 500, "create_failed", "create failed")
		return
	}
	_, _ = s.db.Exec(r.Context(), `
		INSERT INTO conversation_members(conversation_id, user_id, role, history_visible_from)
		VALUES ($1,$2,'owner', TIMESTAMPTZ '1970-01-01')`, id, c.UserID)
	for mid := range unique {
		if mid == c.UserID {
			continue
		}
		_, _ = s.db.Exec(r.Context(), `
			INSERT INTO conversation_members(conversation_id, user_id, role, history_visible_from)
			VALUES ($1,$2,'member', now()) ON CONFLICT DO NOTHING`, id, mid)
	}
	writeJSON(w, 201, map[string]any{"id": id.String(), "public_id": publicID})
}

// handleAddGroupMembers AddChannelMember / invite —
// owner or admin may add any same-tenant user (friendship not required).
func (s *Server) handleAddGroupMembers(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	convID := r.PathValue("id")
	if !s.isGroupAdmin(r, convID, c.UserID) {
		writeErrCode(w, 403, "forbidden", "only owners and admins can add members")
		return
	}
	var req struct {
		MemberIDs []string `json:"member_ids"`
	}
	if err := decodeJSON(r, &req); err != nil || len(req.MemberIDs) == 0 {
		writeErrCode(w, 400, "invalid_request", "member_ids required")
		return
	}
	var ent, typ string
	err := s.db.QueryRow(r.Context(), `
		SELECT COALESCE(enterprise_id::text, ''), type FROM conversations WHERE id=$1`, convID).Scan(&ent, &typ)
	if err != nil || ent != c.EnterpriseID || typ != "social_group" {
		writeErrCode(w, 404, "not_found", "group not found")
		return
	}
	current, err := s.activeGroupMemberCount(r, convID)
	if err != nil {
		writeErrCode(w, 500, "member_count_failed", "member count failed")
		return
	}

	added := make([]string, 0)
	skipped := make([]string, 0)
	for _, mid := range req.MemberIDs {
		mid = strings.TrimSpace(mid)
		if mid == "" || mid == c.UserID {
			continue
		}
		if current+len(added) >= maxSocialGroupMembers {
			skipped = append(skipped, mid)
			continue
		}
		if !s.canInviteUserToGroup(r, c.UserID, mid, c.EnterpriseID) {
			skipped = append(skipped, mid)
			continue
		}
		// Promote pending join requests; insert new members otherwise.
		tag, err := s.db.Exec(r.Context(), `
			UPDATE conversation_members
			SET role='member', history_visible_from=now(), joined_at=now()
			WHERE conversation_id=$1 AND user_id=$2 AND role='pending'`, convID, mid)
		if err == nil && tag.RowsAffected() > 0 {
			added = append(added, mid)
			continue
		}
		tag, err = s.db.Exec(r.Context(), `
			INSERT INTO conversation_members(conversation_id, user_id, role, history_visible_from)
			VALUES ($1,$2,'member', now())
			ON CONFLICT (conversation_id, user_id) DO NOTHING`, convID, mid)
		if err != nil || tag.RowsAffected() == 0 {
			skipped = append(skipped, mid)
			continue
		}
		added = append(added, mid)
	}

	if len(added) > 0 {
		s.hub.PublishToUsers(s.memberIDs(r, convID), ws.Event{
			Type: "group.updated",
			Payload: map[string]any{
				"conversation_id":  convID,
				"added_member_ids": added,
			},
		})
	}
	writeJSON(w, 200, map[string]any{"ok": true, "added": added, "skipped": skipped})
}

// handleRemoveGroupMember RemoveUserFromChannel —
// owner/admin kick a member. Owners may remove admins; admins may only remove members.
// Leave/kick notices go to owners/admins only (requirements-en §8).
func (s *Server) handleRemoveGroupMember(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	convID := r.PathValue("id")
	targetID := strings.TrimSpace(r.PathValue("userId"))
	if targetID == "" {
		writeErrCode(w, 400, "invalid_request", "user id required")
		return
	}
	if targetID == c.UserID {
		writeErrCode(w, 400, "invalid_request", "use leave to remove yourself")
		return
	}

	var ent, typ string
	err := s.db.QueryRow(r.Context(), `
		SELECT COALESCE(enterprise_id::text, ''), type FROM conversations WHERE id=$1`, convID).Scan(&ent, &typ)
	if err != nil || ent != c.EnterpriseID || typ != "social_group" {
		writeErrCode(w, 404, "not_found", "group not found")
		return
	}

	actorRole := s.memberRole(r, convID, c.UserID)
	if actorRole != "owner" && actorRole != "admin" {
		writeErrCode(w, 403, "forbidden", "only owners and admins can remove members")
		return
	}
	targetRole := s.memberRole(r, convID, targetID)
	if targetRole == "" || targetRole == "pending" {
		writeErrCode(w, 404, "not_found", "member not found")
		return
	}
	if targetRole == "owner" {
		writeErrCode(w, 403, "forbidden", "cannot remove the owner")
		return
	}
	if actorRole == "admin" && targetRole == "admin" {
		writeErrCode(w, 403, "forbidden", "admins cannot remove other admins")
		return
	}

	tag, err := s.db.Exec(r.Context(), `
		DELETE FROM conversation_members
		WHERE conversation_id=$1 AND user_id=$2 AND role IN ('member','admin')`, convID, targetID)
	if err != nil || tag.RowsAffected() == 0 {
		writeErrCode(w, 404, "not_found", "member not found")
		return
	}

	payload := map[string]any{
		"conversation_id": convID,
		"removed_user_id": targetID,
		"removed_by":      c.UserID,
	}
	s.audit(r.Context(), c.UserID, c.EnterpriseID, "group.member_remove", "user", targetID, "", clientIP(r), map[string]any{
		"conversation_id": convID,
		"target_role":     targetRole,
	})
	// Notify removed user so their client drops the conversation.
	s.hub.PublishToUsers([]string{targetID}, ws.Event{Type: "group.member_removed", Payload: payload})
	// Owners/admins see the removal; ordinary members stay silent (requirements-en §8).
	s.hub.PublishToUsers(s.adminIDs(r, convID), ws.Event{Type: "group.member_removed", Payload: payload})
	s.insertAdminMemberNotice(r, convID, c.UserID, targetID, "member_removed")
	writeJSON(w, 200, map[string]any{"ok": true})
}

// handleLeaveGroup lets a member/admin voluntarily leave a social group (requirements-en §8).
// Owners cannot leave without transferring ownership. Notices go to owners/admins only.
func (s *Server) handleLeaveGroup(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	convID := r.PathValue("id")

	var ent, typ string
	err := s.db.QueryRow(r.Context(), `
		SELECT COALESCE(enterprise_id::text, ''), type FROM conversations WHERE id=$1`, convID).Scan(&ent, &typ)
	if err != nil || ent != c.EnterpriseID || typ != "social_group" {
		writeErrCode(w, 404, "not_found", "group not found")
		return
	}

	role := s.memberRole(r, convID, c.UserID)
	if role == "" || role == "pending" {
		writeErrCode(w, 404, "not_found", "not a member")
		return
	}
	if role == "owner" {
		writeErrCode(w, 403, "forbidden", "owner cannot leave; transfer ownership first")
		return
	}

	tag, err := s.db.Exec(r.Context(), `
		DELETE FROM conversation_members
		WHERE conversation_id=$1 AND user_id=$2 AND role IN ('member','admin')`, convID, c.UserID)
	if err != nil || tag.RowsAffected() == 0 {
		writeErrCode(w, 404, "not_found", "not a member")
		return
	}

	payload := map[string]any{
		"conversation_id": convID,
		"removed_user_id": c.UserID,
		"removed_by":      c.UserID,
		"left":            true,
	}
	s.hub.PublishToUsers([]string{c.UserID}, ws.Event{Type: "group.member_removed", Payload: payload})
	s.hub.PublishToUsers(s.adminIDs(r, convID), ws.Event{Type: "group.member_removed", Payload: payload})
	s.insertAdminMemberNotice(r, convID, c.UserID, c.UserID, "member_left")
	writeJSON(w, 200, map[string]any{"ok": true})
}

// handleDeleteGroup lets the owner permanently dissolve a social group.
func (s *Server) handleDeleteGroup(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	convID := r.PathValue("id")

	var typ, role string
	var isEnterpriseDefault bool
	err := s.db.QueryRow(r.Context(), `
		SELECT conv.type, cm.role, COALESCE(conv.is_enterprise_default, FALSE)
		FROM conversations conv
		JOIN conversation_members cm ON cm.conversation_id=conv.id AND cm.user_id=$2
		WHERE conv.id=$1
		  AND conv.enterprise_id IS NOT DISTINCT FROM $3
		  AND cm.role <> 'pending'`,
		convID, c.UserID, entArg(c.EnterpriseID)).Scan(&typ, &role, &isEnterpriseDefault)
	if err != nil || typ != "social_group" {
		writeErrCode(w, 404, "not_found", "group not found")
		return
	}
	if role != "owner" {
		writeErrCode(w, 403, "forbidden", "only the owner can delete the group")
		return
	}
	if isEnterpriseDefault {
		writeErrCode(w, 403, "forbidden", "enterprise default group cannot be deleted")
		return
	}

	memberIDs := s.memberIDs(r, convID)
	_, _ = s.db.Exec(r.Context(), `DELETE FROM call_sessions WHERE conversation_id=$1`, convID)
	_, _ = s.db.Exec(r.Context(), `UPDATE webhooks SET conversation_id=NULL WHERE conversation_id=$1`, convID)
	tag, err := s.db.Exec(r.Context(), `DELETE FROM conversations WHERE id=$1`, convID)
	if err != nil || tag.RowsAffected() == 0 {
		writeErrCode(w, 500, "delete_failed", "delete failed")
		return
	}

	for _, uid := range memberIDs {
		s.hub.PublishToUsers([]string{uid}, ws.Event{Type: "group.member_removed", Payload: map[string]any{
			"conversation_id": convID,
			"removed_user_id": uid,
			"removed_by":      c.UserID,
			"deleted":         true,
		}})
	}
	s.audit(r.Context(), c.UserID, c.EnterpriseID, "group.delete", "conversation", convID, "", clientIP(r), nil)
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) handleGroupDetails(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	convID := r.PathValue("id")
	var title, description, announcement, publicID, avatar, role, ownerID, enterpriseName string
	var muteAll, forbidFriendAdd, isEnterpriseDefault bool
	err := s.db.QueryRow(r.Context(), `
		SELECT conv.title, COALESCE(conv.description,''), COALESCE(conv.announcement,''),
		       COALESCE(conv.public_id,''), COALESCE(conv.avatar_url,''),
		       conv.mute_all, COALESCE(conv.forbid_member_friend_add, FALSE),
		       COALESCE(conv.is_enterprise_default, FALSE),
		       cm.role, conv.owner_id::text, COALESCE(e.name, '')
		FROM conversations conv
		JOIN conversation_members cm ON cm.conversation_id=conv.id AND cm.user_id=$2
		LEFT JOIN enterprises e ON e.id = conv.enterprise_id
		WHERE conv.id=$1
		  AND conv.type='social_group'
		  AND cm.role <> 'pending'`,
		convID, c.UserID).Scan(
		&title, &description, &announcement, &publicID, &avatar, &muteAll, &forbidFriendAdd,
		&isEnterpriseDefault, &role, &ownerID, &enterpriseName)
	if err != nil {
		writeErrCode(w, 404, "not_found", "group not found")
		return
	}
	mrows, _ := s.db.Query(r.Context(), `
		SELECT u.id::text, u.username, u.display_name, COALESCE(u.avatar_url,''), cm.role, cm.mute_until,
		       u.last_active_at
		FROM conversation_members cm JOIN users u ON u.id=cm.user_id
		WHERE cm.conversation_id=$1 AND cm.role <> 'pending'
		ORDER BY CASE cm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.display_name`, convID)
	var members []map[string]any
	var memberIDs []string
	if mrows != nil {
		defer mrows.Close()
		for mrows.Next() {
			var uid, un, dn, av, mrole string
			var muteUntil *time.Time
			var lastActive *time.Time
			_ = mrows.Scan(&uid, &un, &dn, &av, &mrole, &muteUntil, &lastActive)
			item := map[string]any{
				"user_id": uid, "username": un, "display_name": dn, "avatar_url": av, "role": mrole,
			}
			if muteUntil != nil {
				item["mute_until"] = muteUntil.UTC()
			}
			if lastActive != nil {
				item["last_active_at"] = lastActive.UTC()
			}
			members = append(members, item)
			memberIDs = append(memberIDs, uid)
		}
	}
	if members == nil {
		members = []map[string]any{}
	}
	online := s.hub.OnlineUserIDs(memberIDs)
	for _, item := range members {
		uid, _ := item["user_id"].(string)
		item["online"] = online[uid]
	}
	writeJSON(w, 200, map[string]any{
		"id": convID, "title": title, "description": description, "announcement": announcement,
		"public_id": publicID, "avatar_url": avatar, "mute_all": muteAll,
		"forbid_member_friend_add": forbidFriendAdd,
		"is_enterprise_default":    isEnterpriseDefault,
		"enterprise_name":          enterpriseName,
		"role":                     role, "owner_id": ownerID, "members": members,
	})
}

// handlePatchGroup patchChannel / setTeamIcon for group metadata.
func (s *Server) handlePatchGroup(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	convID := r.PathValue("id")
	if !s.isGroupAdmin(r, convID, c.UserID) {
		writeErrCode(w, 403, "forbidden", "only owners and admins can edit group")
		return
	}
	// Membership (isGroupAdmin) is the authz gate for group settings.
	var typ string
	err := s.db.QueryRow(r.Context(), `
		SELECT type FROM conversations WHERE id=$1`, convID).Scan(&typ)
	if err != nil || typ != "social_group" {
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
			avatar_url=COALESCE($4, avatar_url),
			announcement=COALESCE($5, announcement),
			forbid_member_friend_add=COALESCE($6, forbid_member_friend_add)
		WHERE id=$1`,
		convID,
		strPtr(req, "title"),
		strPtr(req, "description"),
		strPtr(req, "avatar_url"),
		strPtr(req, "announcement"),
		boolPtr(req, "forbid_member_friend_add"),
	)
	if err != nil {
		writeErrCode(w, 400, "update_failed", "update failed")
		return
	}
	// Re-read so the WS payload reflects the persisted boolean (not a possibly
	// omitted JSON field), so other members clear "members cannot…" when off.
	var forbidFriendAdd bool
	_ = s.db.QueryRow(r.Context(), `
		SELECT COALESCE(forbid_member_friend_add, FALSE) FROM conversations WHERE id=$1`,
		convID).Scan(&forbidFriendAdd)
	s.hub.PublishToUsers(s.memberIDs(r, convID), ws.Event{
		Type: "group.updated",
		Payload: map[string]any{
			"conversation_id":          convID,
			"title":                    req["title"],
			"description":              req["description"],
			"avatar_url":               req["avatar_url"],
			"announcement":             req["announcement"],
			"forbid_member_friend_add": forbidFriendAdd,
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
	rows, err := s.db.Query(r.Context(), `
		SELECT u.id::text, u.username, u.display_name, COALESCE(u.avatar_url,''),
		       COALESCE(u.enterprise_id::text,''), COALESCE(e.name,''), cm.joined_at
		FROM conversation_members cm
		JOIN users u ON u.id=cm.user_id
		LEFT JOIN enterprises e ON e.id = u.enterprise_id
		WHERE cm.conversation_id=$1 AND cm.role='pending'
		ORDER BY cm.joined_at`, convID)
	if err != nil {
		writeErrCode(w, 500, "query_failed", "query failed")
		return
	}
	defer rows.Close()
	var pending []map[string]any
	for rows.Next() {
		var uid, un, dn, av, eid, ename string
		var joined time.Time
		_ = rows.Scan(&uid, &un, &dn, &av, &eid, &ename, &joined)
		row := map[string]any{
			"user_id": uid, "username": un, "display_name": dn, "avatar_url": av, "requested_at": joined.UTC(),
		}
		if eid != "" {
			row["enterprise_id"] = eid
		}
		if ename != "" {
			row["enterprise_name"] = ename
		}
		pending = append(pending, row)
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
	action := "group.admin_appoint"
	if req.Role == "member" {
		action = "group.admin_demote"
	}
	s.audit(r.Context(), c.UserID, c.EnterpriseID, action, "user", req.UserID, "", clientIP(r), map[string]any{
		"conversation_id": convID,
		"role":            req.Role,
	})
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
	req.PublicID = strings.TrimSpace(req.PublicID)
	if req.PublicID == "" {
		writeErr(w, 400, "public_id required")
		return
	}
	// Join-by-ID is intentionally global (requirements: find a group by group ID).
	// Friendship and enterprise matching are not required; owners/admins still approve.
	// Legacy company default chats (if any remain) stay hidden from join-by-ID.
	// Cross-enterprise member *invites* remain tenant-scoped in canInviteUserToGroup /
	// handleAddGroupMembers.
	var convID, owner string
	var isDefault bool
	err := s.db.QueryRow(r.Context(), `
		SELECT id::text, COALESCE(owner_id::text, ''),
		       COALESCE(is_enterprise_default, FALSE)
		FROM conversations
		WHERE LOWER(public_id)=LOWER($1) AND type='social_group'`,
		req.PublicID).
		Scan(&convID, &owner, &isDefault)
	if err != nil || isDefault {
		writeErr(w, 404, "group not found")
		return
	}
	// Already an active member — do not create a duplicate pending row.
	var existingRole string
	_ = s.db.QueryRow(r.Context(), `
		SELECT role FROM conversation_members
		WHERE conversation_id=$1 AND user_id=$2`, convID, c.UserID).Scan(&existingRole)
	if existingRole == "owner" || existingRole == "admin" || existingRole == "member" {
		writeJSON(w, 200, s.joinGroupResponse(r.Context(), "already_member", convID, existingRole))
		return
	}
	if existingRole == "pending" {
		writeJSON(w, 202, s.joinGroupResponse(r.Context(), "pending_approval", convID, "pending"))
		return
	}
	_, err = s.db.Exec(r.Context(), `
		INSERT INTO conversation_members(conversation_id, user_id, role, history_visible_from)
		VALUES ($1,$2,'pending', now()) ON CONFLICT DO NOTHING`, convID, c.UserID)
	if err != nil {
		writeErr(w, 400, "join failed")
		return
	}
	// Owners and administrators both approve joins (handleApproveJoin), so both
	// must see the request. adminIDs covers the owner row; fall back to the
	// conversation's owner_id if the membership row is somehow missing.
	approvers := s.adminIDs(r, convID)
	if len(approvers) == 0 && owner != "" {
		approvers = []string{owner}
	}
	s.hub.PublishToUsers(approvers, ws.Event{Type: "group.join_request", Payload: map[string]any{"conversation_id": convID, "user_id": c.UserID}})
	writeJSON(w, 202, s.joinGroupResponse(r.Context(), "pending_approval", convID, "pending"))
}

// joinGroupResponse returns join status plus group list fields so clients can
// show the conversation under Your groups immediately (role=pending).
func (s *Server) joinGroupResponse(ctx context.Context, status, convID, role string) map[string]any {
	out := map[string]any{
		"status":          status,
		"conversation_id": convID,
		"role":            role,
	}
	var title, publicID, avatar, enterpriseName string
	_ = s.db.QueryRow(ctx, `
		SELECT COALESCE(c.title,''), COALESCE(c.public_id,''), COALESCE(c.avatar_url,''),
		       COALESCE(e.name,'')
		FROM conversations c
		LEFT JOIN enterprises e ON e.id = c.enterprise_id
		WHERE c.id=$1`, convID).Scan(&title, &publicID, &avatar, &enterpriseName)
	if title != "" {
		out["title"] = title
	}
	if publicID != "" {
		out["public_id"] = publicID
	}
	if avatar != "" {
		out["avatar_url"] = avatar
	}
	if enterpriseName != "" {
		out["enterprise_name"] = enterpriseName
	}
	return out
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
	current, err := s.activeGroupMemberCount(r, convID)
	if err != nil {
		writeErrCode(w, 500, "member_count_failed", "member count failed")
		return
	}
	if current >= maxSocialGroupMembers {
		writeErrCode(w, 400, "group_full", fmt.Sprintf("group member limit is %d", maxSocialGroupMembers))
		return
	}
	tag, err := s.db.Exec(r.Context(), `
		UPDATE conversation_members SET role='member', history_visible_from=now(), joined_at=now()
		WHERE conversation_id=$1 AND user_id=$2 AND role='pending'`, convID, req.UserID)
	if err != nil || tag.RowsAffected() == 0 {
		writeErr(w, 400, "approve failed")
		return
	}
	// Notify members (including the newly approved user) so clients can refresh
	// membership / conversation lists. Approvers also get pending_changed so a
	// second admin's open pending list shrinks without a manual reload.
	s.hub.PublishToUsers(s.memberIDs(r, convID), ws.Event{
		Type: "group.updated",
		Payload: map[string]any{
			"conversation_id":  convID,
			"added_member_ids": []string{req.UserID},
		},
	})
	s.hub.PublishToUsers(s.adminIDs(r, convID), ws.Event{
		Type: "group.pending_changed",
		Payload: map[string]any{
			"conversation_id": convID,
			"user_id":         req.UserID,
			"action":          "approved",
		},
	})
	s.audit(r.Context(), c.UserID, c.EnterpriseID, "group.join_approve", "user", req.UserID, "", clientIP(r), map[string]any{
		"conversation_id": convID,
	})
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
	if req.Duration == "all" || req.Duration == "all_off" {
		on := req.Duration == "all"
		_, _ = s.db.Exec(r.Context(), `UPDATE conversations SET mute_all=$2 WHERE id=$1`, convID, on)
		s.audit(r.Context(), c.UserID, c.EnterpriseID, "group.mute_all", "conversation", convID, "", clientIP(r), map[string]any{"mute_all": on})
		writeJSON(w, 200, map[string]any{"mute_all": on})
		return
	}
	if req.Duration == "off" {
		_, err := s.db.Exec(r.Context(), `
			UPDATE conversation_members SET mute_until=NULL
			WHERE conversation_id=$1 AND user_id=$2`, convID, req.UserID)
		if err != nil {
			writeErr(w, 400, "unmute failed")
			return
		}
		s.audit(r.Context(), c.UserID, c.EnterpriseID, "group.unmute", "user", req.UserID, "", clientIP(r), map[string]any{"conversation_id": convID})
		writeJSON(w, 200, map[string]any{"mute_until": nil})
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
	s.audit(r.Context(), c.UserID, c.EnterpriseID, "group.mute", "user", req.UserID, "", clientIP(r), map[string]any{
		"conversation_id": convID,
		"duration":        req.Duration,
	})
	writeJSON(w, 200, map[string]any{"mute_until": until})
}

func (s *Server) handleListMessages(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	convID := r.PathValue("id")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	var beforeSeq int64
	if raw := strings.TrimSpace(r.URL.Query().Get("before_seq")); raw != "" {
		v, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || v <= 0 {
			writeErr(w, 400, "invalid before_seq")
			return
		}
		beforeSeq = v
	}
	var histFrom time.Time
	var role, convType string
	err := s.db.QueryRow(r.Context(), `
		SELECT cm.history_visible_from, cm.role, conv.type
		FROM conversation_members cm
		JOIN conversations conv ON conv.id=cm.conversation_id
		WHERE cm.conversation_id=$1 AND cm.user_id=$2`,
		convID, c.UserID).Scan(&histFrom, &role, &convType)
	if err != nil || role == "pending" {
		writeErrCode(w, 403, "not_a_member", "not a member")
		return
	}
	isAdmin := role == "owner" || role == "admin"
	// Groups: ordinary members never see recalled messages or notices.
	// DMs: participants see an explicit recall notice.
	showRecalled := convType == "dm" || isAdmin
	// Fetch one extra row so the client can tell whether older history remains
	// without a separate COUNT query.
	fetch := limit + 1
	rows, err := s.db.Query(r.Context(), `
		SELECT m.id::text, m.sender_id::text, m.client_msg_id, m.seq, m.type,
		       CASE
		         WHEN m.recalled AND NOT $4 THEN ''
		         ELSE m.body
		       END,
		       m.media_url, m.reply_to_id::text, m.mention_all, m.recalled, m.created_at,
		       u.display_name, COALESCE(u.avatar_url, ''), m.edited_at,
		       COALESCE((SELECT array_agg(x::text) FROM unnest(m.mentions) AS x), '{}')
		FROM messages m JOIN users u ON u.id=m.sender_id
		WHERE m.conversation_id=$1 AND m.created_at >= $2
		  AND ($3 OR m.recalled=FALSE)
		  AND ($4 OR m.type <> 'system')
		  AND ($6::bigint = 0 OR m.seq < $6)
		ORDER BY m.seq DESC LIMIT $5`, convID, histFrom, showRecalled, isAdmin, fetch, beforeSeq)
	if err != nil {
		writeErrCode(w, 500, "query_failed", "query failed")
		return
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, sid, cmid, typ, body, media, reply, dname, savatar string
		var seq int64
		var mentionAll, recalled bool
		var created time.Time
		var editedAt *time.Time
		var replyPtr *string
		var mentions []string
		_ = rows.Scan(&id, &sid, &cmid, &seq, &typ, &body, &media, &replyPtr, &mentionAll, &recalled, &created, &dname, &savatar, &editedAt, &mentions)
		if replyPtr != nil {
			reply = *replyPtr
		}
		if mentions == nil {
			mentions = []string{}
		}
		item := map[string]any{
			"id": id, "sender_id": sid, "client_msg_id": cmid, "seq": seq, "type": typ,
			"body": body, "media_url": media, "reply_to_id": reply, "mention_all": mentionAll,
			"mentions": mentions,
			"recalled": recalled, "created_at": created, "sender_name": dname,
			"sender_avatar": savatar, "conversation_id": convID,
		}
		if editedAt != nil {
			item["edited_at"] = editedAt.UTC()
		}
		out = append(out, item)
	}
	if out == nil {
		out = []map[string]any{}
	}
	hasMore := len(out) > limit
	if hasMore {
		out = out[:limit]
	}
	// reverse to chronological
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	s.attachReactions(r, out, c.UserID)
	s.attachReceipts(r, out, c.UserID, convID)
	writeJSON(w, 200, map[string]any{"messages": out, "has_more": hasMore})
}

// attachReceipts sets delivered/read on the viewer's own messages.
// DMs use peer watermark + message_receipts; social groups attach per-member read_by/unread_by.
func (s *Server) attachReceipts(r *http.Request, msgs []map[string]any, viewerID, convID string) {
	if len(msgs) == 0 {
		return
	}
	var convType string
	_ = s.db.QueryRow(r.Context(), `SELECT type FROM conversations WHERE id=$1`, convID).Scan(&convType)

	type memberRead struct {
		ID     string
		Name   string
		Avatar string
		Seq    int64
	}

	if convType == "social_group" || convType == "group" {
		rows, err := s.db.Query(r.Context(), `
			SELECT u.id::text, COALESCE(NULLIF(u.display_name,''), u.username), COALESCE(u.avatar_url,''), cm.last_read_seq
			FROM conversation_members cm
			JOIN users u ON u.id=cm.user_id
			WHERE cm.conversation_id=$1 AND cm.role <> 'pending' AND cm.user_id<>$2`,
			convID, viewerID)
		var members []memberRead
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var m memberRead
				if rows.Scan(&m.ID, &m.Name, &m.Avatar, &m.Seq) == nil {
					members = append(members, m)
				}
			}
		}
		memberCount := len(members)
		for _, msg := range msgs {
			sid, _ := msg["sender_id"].(string)
			if sid != viewerID {
				continue
			}
			seq := msgSeq(msg)
			var readBy, unreadBy []map[string]any
			for _, m := range members {
				item := map[string]any{
					"user_id": m.ID, "display_name": m.Name, "avatar_url": m.Avatar,
				}
				if seq > 0 && m.Seq >= seq {
					readBy = append(readBy, item)
				} else {
					unreadBy = append(unreadBy, item)
				}
			}
			if readBy == nil {
				readBy = []map[string]any{}
			}
			if unreadBy == nil {
				unreadBy = []map[string]any{}
			}
			msg["read_by"] = readBy
			msg["unread_by"] = unreadBy
			msg["read_count"] = len(readBy)
			msg["member_count"] = memberCount
			msg["read"] = memberCount > 0 && len(readBy) == memberCount
			msg["delivered"] = len(readBy) > 0 || memberCount == 0
		}
		return
	}

	var peerReadSeq int64
	_ = s.db.QueryRow(r.Context(), `
		SELECT COALESCE(MAX(last_read_seq), 0)
		FROM conversation_members
		WHERE conversation_id=$1 AND user_id<>$2 AND role <> 'pending'`,
		convID, viewerID).Scan(&peerReadSeq)

	ids := make([]string, 0, len(msgs))
	for _, m := range msgs {
		id, _ := m["id"].(string)
		sid, _ := m["sender_id"].(string)
		if id != "" && sid == viewerID {
			ids = append(ids, id)
		}
	}
	delivered := map[string]bool{}
	read := map[string]bool{}
	if len(ids) > 0 {
		rows, err := s.db.Query(r.Context(), `
			SELECT message_id::text, status FROM message_receipts
			WHERE message_id = ANY($1::uuid[]) AND user_id <> $2`, ids, viewerID)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var mid, st string
				if rows.Scan(&mid, &st) != nil {
					continue
				}
				if st == "read" {
					read[mid] = true
					delivered[mid] = true
				} else if st == "delivered" {
					delivered[mid] = true
				}
			}
		}
	}
	for _, m := range msgs {
		sid, _ := m["sender_id"].(string)
		if sid != viewerID {
			continue
		}
		id, _ := m["id"].(string)
		seq := msgSeq(m)
		isRead := read[id] || (seq > 0 && seq <= peerReadSeq)
		isDelivered := delivered[id] || isRead
		m["delivered"] = isDelivered
		m["read"] = isRead
	}
}

func msgSeq(m map[string]any) int64 {
	switch v := m["seq"].(type) {
	case int64:
		return v
	case int:
		return int64(v)
	case float64:
		return int64(v)
	default:
		return 0
	}
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
	"\u2764":       true, // ❤ (no VS16)
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
	var convID string
	var recalled bool
	err := s.db.QueryRow(r.Context(), `
		SELECT m.conversation_id::text, m.recalled
		FROM messages m JOIN conversations conv ON conv.id=m.conversation_id
		WHERE m.id=$1`, msgID).Scan(&convID, &recalled)
	if err != nil {
		writeErrCode(w, 404, "not_found", "not found")
		return
	}
	role := s.memberRole(r, convID, c.UserID)
	// Membership is enough to react.
	if role == "" || role == "pending" {
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

// voiceDurationOK enforces requirements-en §2.4 (max 60s recorded voice).
func voiceDurationOK(sec int) bool {
	return sec >= 1 && sec <= 60
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
		DurationSec int      `json:"duration_sec"`
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
	// requirements-en §2.4: recorded voice messages are capped at 60 seconds.
	if req.Type == "voice" && !voiceDurationOK(req.DurationSec) {
		writeErr(w, 400, "voice duration must be 1–60 seconds")
		return
	}
	var role string
	var muteUntil *time.Time
	var muteAll bool
	var convType string
	err := s.db.QueryRow(r.Context(), `
		SELECT cm.role, cm.mute_until, conv.mute_all, conv.type
		FROM conversation_members cm JOIN conversations conv ON conv.id=cm.conversation_id
		WHERE cm.conversation_id=$1 AND cm.user_id=$2`, convID, c.UserID).Scan(&role, &muteUntil, &muteAll, &convType)
	if err != nil || role == "pending" {
		writeErr(w, 403, "not a member")
		return
	}
	if convType == "dm" {
		var peerID string
		_ = s.db.QueryRow(r.Context(), `
			SELECT user_id::text FROM conversation_members
			WHERE conversation_id=$1 AND user_id<>$2
			LIMIT 1`, convID, c.UserID).Scan(&peerID)
		if peerID != "" && s.friendshipBlocked(r, c.UserID, peerID, c.EnterpriseID) {
			writeErrCode(w, 403, "blocked", "cannot message this user")
			return
		}
	}
	if muteAll && role != "owner" && role != "admin" {
		writeErr(w, 403, "group muted")
		return
	}
	if muteUntil != nil && muteUntil.After(time.Now()) && role != "owner" && role != "admin" {
		writeErr(w, 403, "you are muted")
		return
	}
	// mention parsing from message text when client omits mentions.
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
		RETURNING id::text, seq`, newID, convID, entArg(c.EnterpriseID), c.UserID, req.ClientMsgID, req.Type, req.Body, req.MediaURL, reply, mentionLiteral, req.MentionAll).Scan(&msgID, &seq)
	if err != nil {
		writeErr(w, 500, "send failed: "+err.Error())
		return
	}
	memberIDs := s.memberIDs(r, convID)
	var senderName, senderAvatar string
	_ = s.db.QueryRow(r.Context(), `SELECT display_name, avatar_url FROM users WHERE id=$1`, c.UserID).
		Scan(&senderName, &senderAvatar)
	payload := map[string]any{
		"id": msgID, "conversation_id": convID, "sender_id": c.UserID, "client_msg_id": req.ClientMsgID,
		"seq": seq, "type": req.Type, "body": req.Body, "media_url": req.MediaURL, "created_at": time.Now().UTC(),
		"mentions": req.Mentions, "mention_all": req.MentionAll,
		"sender_name": senderName, "sender_avatar": senderAvatar,
	}
	if req.ReplyToID != "" {
		payload["reply_to_id"] = req.ReplyToID
	}
	pubStart := time.Now()
	s.hub.PublishToUsers(memberIDs, ws.Event{Type: "message.new", Payload: payload})
	messagePublishDuration.Observe(time.Since(pubStart).Seconds())
	preview := req.Body
	if len([]rune(preview)) > 80 {
		preview = string([]rune(preview)[:80]) + "…"
	}
	s.goPushJob(func() {
		s.notifyMessagePush(context.Background(), convID, c.UserID, senderName, senderAvatar, preview, memberIDs, req.Mentions, req.MentionAll)
	})
	writeJSON(w, 201, payload)
}

// parseMentions @user / @channel / @all / @everyone extraction.
func (s *Server) parseMentions(r *http.Request, convID, enterpriseID, body string) ([]string, bool) {
	reAll := regexp.MustCompile(`(?i)@(?:all|channel|everyone)\b`)
	mentionAll := reAll.MatchString(body)
	re := regexp.MustCompile(`@([a-zA-Z0-9_]{2,32})\b`)
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
		WHERE u.enterprise_id IS NOT DISTINCT FROM $2 AND lower(u.username) = ANY($3::text[])`,
		convID, entArg(enterpriseID), list)
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
	// Message bodies stay out of the audit meta; the log records who acted on
	// what, not the content, which is reachable only through messages.inspect.
	s.audit(r.Context(), c.UserID, c.EnterpriseID, "message.recall", "message", msgID, "", clientIP(r), map[string]any{
		"conversation_id": convID,
		"sender_id":       sender,
		"by_moderator":    sender != c.UserID,
	})
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
	s.hub.PublishToUsers([]string{sender}, ws.Event{Type: "message.read", Payload: map[string]any{
		"id": msgID, "by": c.UserID, "conversation_id": convID, "seq": seq,
	}})
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
		var destEnt, destType string
		_ = s.db.QueryRow(r.Context(), `
			SELECT COALESCE(enterprise_id::text, ''), type FROM conversations WHERE id=$1`, cid).
			Scan(&destEnt, &destType)
		if destEnt != c.EnterpriseID {
			continue
		}
		if destType == "dm" {
			var peerID string
			_ = s.db.QueryRow(r.Context(), `
				SELECT user_id::text FROM conversation_members
				WHERE conversation_id=$1 AND user_id<>$2 LIMIT 1`, cid, c.UserID).Scan(&peerID)
			if peerID != "" && s.friendshipBlocked(r, c.UserID, peerID, c.EnterpriseID) {
				continue
			}
		}
		id := uuid.New()
		_, err := s.db.Exec(r.Context(), `
			INSERT INTO messages(id, conversation_id, enterprise_id, sender_id, client_msg_id, type, body, media_url, forwarded_from)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
			id, cid, entArg(c.EnterpriseID), c.UserID, uuid.NewString(), typ, body, media, msgID)
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
	return s.memberIDsCtx(r.Context(), convID)
}

func (s *Server) memberIDsCtx(ctx context.Context, convID string) []string {
	rows, err := s.db.Query(ctx, `SELECT user_id::text FROM conversation_members WHERE conversation_id=$1 AND role <> 'pending'`, convID)
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

// insertAdminMemberNotice persists a system notice for leave/kick and publishes
// message.new only to owners/admins (requirements-en §8). Ordinary members never
// receive the event or see the row in history.
func (s *Server) insertAdminMemberNotice(r *http.Request, convID, actorID, targetID, kind string) {
	userName := s.userDisplayName(r, targetID)
	byName := s.userDisplayName(r, actorID)
	if strings.TrimSpace(userName) == "" {
		_ = s.db.QueryRow(r.Context(), `SELECT username FROM users WHERE id=$1`, targetID).Scan(&userName)
	}
	if strings.TrimSpace(byName) == "" {
		_ = s.db.QueryRow(r.Context(), `SELECT username FROM users WHERE id=$1`, actorID).Scan(&byName)
	}
	if strings.TrimSpace(userName) == "" {
		userName = "User"
	}
	if strings.TrimSpace(byName) == "" {
		byName = "User"
	}
	bodyObj := map[string]any{
		"kind":      kind,
		"user_id":   targetID,
		"user_name": userName,
		"by_id":     actorID,
		"by_name":   byName,
	}
	bodyBytes, err := json.Marshal(bodyObj)
	if err != nil {
		return
	}
	msgID := uuid.New()
	clientMsgID := fmt.Sprintf("system:%s:%s:%s", kind, targetID, msgID.String())
	var outID string
	var seq int64
	var created time.Time
	err = s.db.QueryRow(r.Context(), `
		INSERT INTO messages(id, conversation_id, enterprise_id, sender_id, client_msg_id, type, body)
		SELECT $1, c.id, c.enterprise_id, $2, $3, 'system', $4
		FROM conversations c WHERE c.id=$5
		RETURNING id::text, seq, created_at`,
		msgID, actorID, clientMsgID, string(bodyBytes), convID,
	).Scan(&outID, &seq, &created)
	if err != nil {
		log.Printf("admin member notice insert: %v", err)
		return
	}
	payload := map[string]any{
		"id": outID, "conversation_id": convID, "sender_id": actorID,
		"client_msg_id": clientMsgID, "seq": seq, "type": "system",
		"body": string(bodyBytes), "media_url": "", "created_at": created.UTC(),
		"sender_name": byName, "mentions": []string{}, "mention_all": false,
	}
	admins := s.adminIDs(r, convID)
	if len(admins) == 0 {
		return
	}
	s.hub.PublishToUsers(admins, ws.Event{Type: "message.new", Payload: payload})
}
