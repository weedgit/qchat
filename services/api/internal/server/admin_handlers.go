package server

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/qchat/qchat/services/api/internal/auth"
	"github.com/qchat/qchat/services/api/internal/ws"
)

var (
	errAdminUserNotFound = errors.New("user not found")
	errAdminUserInvalid  = errors.New("invalid user identifier")
)

// adminManagedUser returns the target user's enterprise when the operator may manage them.
func (s *Server) adminManagedUser(ctx context.Context, c *auth.Claims, userID string) (enterpriseID string, ok bool, err error) {
	err = s.db.QueryRow(ctx, `
		SELECT COALESCE(enterprise_id::text, '') FROM users WHERE id=$1`, userID).Scan(&enterpriseID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	if !isPlatformAdminRole(c.Role) && enterpriseID != c.EnterpriseID {
		return "", false, nil
	}
	return enterpriseID, true, nil
}

const (
	adminUsersDefaultLimit = 50
	adminUsersMaxLimit     = 200
	// adminReasonMinLen is the minimum when an operator supplies a custom audit reason.
	adminReasonMinLen = 8
	adminInspectReasonEnterprise = "enterprise_scope"
)

// escapeLike neutralises LIKE wildcards in operator-supplied search text so a
// query for "_" or "%" matches those literal characters instead of everything.
// Callers must pair it with ESCAPE '\'.
func escapeLike(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(s)
}

// adminListRange reads limit/offset paging parameters, clamping them to a sane
// window so a malformed query cannot ask for the whole table.
func adminListRange(r *http.Request) (limit, offset int) {
	limit = adminUsersDefaultLimit
	if v, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && v > 0 {
		limit = v
	}
	if limit > adminUsersMaxLimit {
		limit = adminUsersMaxLimit
	}
	if v, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil && v > 0 {
		offset = v
	}
	return limit, offset
}

// adminReason validates the mandatory justification recorded in the audit log
// for privileged account actions (requirements-en §5).
func adminReason(w http.ResponseWriter, raw string) (string, bool) {
	reason := strings.TrimSpace(raw)
	if len(reason) < adminReasonMinLen {
		writeErr(w, 400, fmt.Sprintf("reason required (≥%d chars)", adminReasonMinLen))
		return "", false
	}
	return reason, true
}

// revokeUserSessions signs a user out everywhere: it marks their sessions
// revoked and closes any live WebSocket so the sign-out takes effect
// immediately rather than at the next reconnect.
func (s *Server) revokeUserSessions(r *http.Request, userID, reason string) {
	rows, err := s.db.Query(r.Context(), `
		SELECT id::text FROM sessions WHERE user_id=$1 AND revoked=FALSE`, userID)
	ids := make([]string, 0)
	if err == nil {
		for rows.Next() {
			var id string
			if rows.Scan(&id) == nil && id != "" {
				ids = append(ids, id)
			}
		}
		rows.Close()
	}
	_, _ = s.db.Exec(r.Context(), `UPDATE sessions SET revoked=TRUE WHERE user_id=$1`, userID)
	s.kickRevokedSessions(ids, reason)
}

func (s *Server) handleAdminEnterprises(w http.ResponseWriter, r *http.Request) {
	c := s.requirePerm(w, r, permAdminRead)
	if c == nil {
		return
	}

	where := "TRUE"
	args := []any{}
	if !isPlatformAdminRole(c.Role) {
		args = append(args, c.EnterpriseID)
		where = fmt.Sprintf("id = $%d", len(args))
	}
	if q := strings.TrimSpace(r.URL.Query().Get("q")); q != "" {
		args = append(args, "%"+escapeLike(q)+"%")
		n := len(args)
		where += fmt.Sprintf(
			` AND (name ILIKE $%d ESCAPE '\' OR invite_code ILIKE $%d ESCAPE '\')`,
			n, n)
	}

	var total int
	if err := s.db.QueryRow(r.Context(), `SELECT COUNT(*) FROM enterprises WHERE `+where, args...).Scan(&total); err != nil {
		writeErr(w, 500, "query failed")
		return
	}

	limit, offset := adminListRange(r)
	listArgs := append(append([]any{}, args...), limit, offset)
	nLimit := len(listArgs) - 1
	nOffset := len(listArgs)
	listQ := fmt.Sprintf(`
		SELECT id::text, name, invite_code, invite_active, retention_days,
		       COALESCE(support_email,''), COALESCE(support_phone,''), created_at
		FROM enterprises
		WHERE %s
		ORDER BY created_at DESC
		LIMIT $%d OFFSET $%d`, where, nLimit, nOffset)

	rows, err := s.db.Query(r.Context(), listQ, listArgs...)
	if err != nil {
		writeErr(w, 500, "query failed")
		return
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, name, code, supportEmail, supportPhone string
		var active bool
		var days int
		var created any
		_ = rows.Scan(&id, &name, &code, &active, &days, &supportEmail, &supportPhone, &created)
		out = append(out, map[string]any{
			"id": id, "name": name, "invite_code": code, "invite_active": active,
			"retention_days": days, "support_email": supportEmail, "support_phone": supportPhone,
			"created_at": created,
		})
	}
	if out == nil {
		out = []map[string]any{}
	}
	writeJSON(w, 200, map[string]any{"enterprises": out, "total": total, "limit": limit, "offset": offset})
}

func (s *Server) handleAdminCreateEnterprise(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	if !isPlatformAdminRole(c.Role) {
		writeErr(w, 403, "forbidden")
		return
	}
	var req struct {
		Name          string `json:"name"`
		InviteCode    string `json:"invite_code"`
		AdminPhone    string `json:"admin_phone"`
		AdminPassword string `json:"admin_password"`
		AdminUsername string `json:"admin_username"`
		SupportEmail  string `json:"support_email"`
		SupportPhone  string `json:"support_phone"`
	}
	if err := decodeJSON(r, &req); err != nil || strings.TrimSpace(req.Name) == "" {
		writeErrCode(w, 400, "invalid_request", "name required")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	supportEmail, err := normalizeEnterpriseSupportEmail(req.SupportEmail)
	if err != nil {
		writeErrCode(w, 400, "invalid_support_email", err.Error())
		return
	}
	supportPhone, err := normalizeEnterpriseSupportPhone(req.SupportPhone)
	if err != nil {
		writeErrCode(w, 400, "invalid_support_phone", err.Error())
		return
	}
	if !auth.ValidatePhone(req.AdminPhone) {
		writeErrCode(w, 400, "invalid_phone", "admin_phone must be 11 digits")
		return
	}
	if err := auth.ValidatePassword(req.AdminPassword); err != nil {
		writeErrCode(w, 400, "invalid_password", err.Error())
		return
	}
	uname := strings.TrimSpace(req.AdminUsername)
	if uname == "" {
		if req.InviteCode != "" {
			uname = "admin_" + strings.ToUpper(req.InviteCode)
		} else {
			uname = "admin_" + strings.ToLower(uuid.NewString()[:8])
		}
	}
	if !auth.ValidateUsername(uname) {
		writeErrCode(w, 400, "invalid_username", "invalid admin_username")
		return
	}
	if req.InviteCode == "" {
		req.InviteCode = strings.ToUpper(uuid.NewString()[:8])
	} else {
		req.InviteCode = strings.ToUpper(strings.TrimSpace(req.InviteCode))
	}

	var taken bool
	if err := s.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM enterprises WHERE lower(trim(name))=lower($1))`, req.Name).Scan(&taken); err != nil {
		writeErrCode(w, 500, "query_failed", "query failed")
		return
	} else if taken {
		writeErrCode(w, 409, "enterprise_name_taken", "company name already exists")
		return
	}
	if err := s.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM enterprises WHERE invite_code=$1)`, req.InviteCode).Scan(&taken); err != nil {
		writeErrCode(w, 500, "query_failed", "query failed")
		return
	} else if taken {
		writeErrCode(w, 409, "invite_code_taken", "invite code already in use")
		return
	}
	if err := s.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM users WHERE phone=$1)`, req.AdminPhone).Scan(&taken); err != nil {
		writeErrCode(w, 500, "query_failed", "query failed")
		return
	} else if taken {
		writeErrCode(w, 409, "phone_taken", "admin phone already registered")
		return
	}

	hash, err := auth.HashPassword(req.AdminPassword)
	if err != nil {
		writeErrCode(w, 500, "hash_failed", "hash failed")
		return
	}

	tx, err := s.db.Begin(r.Context())
	if err != nil {
		writeErrCode(w, 500, "create_failed", "create failed")
		return
	}
	defer tx.Rollback(r.Context())

	id := uuid.New()
	if _, err := tx.Exec(r.Context(), `
		INSERT INTO enterprises(id, name, invite_code, support_email, support_phone)
		VALUES ($1,$2,$3,$4,$5)`, id, req.Name, req.InviteCode, supportEmail, supportPhone); err != nil {
		writeErrCode(w, 409, "invite_code_taken", "invite code already in use")
		return
	}
	uid := uuid.New()
	if _, err := tx.Exec(r.Context(), `
		INSERT INTO users(id, enterprise_id, phone, password_hash, username, display_name, role)
		VALUES ($1,$2,$3,$4,$5,$5,'enterprise_admin')`, uid, id, req.AdminPhone, hash, uname); err != nil {
		writeErrCode(w, 409, "admin_create_failed", "admin phone or username already exists")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErrCode(w, 500, "create_failed", "create failed")
		return
	}
	adminUserID := uid.String()
	s.audit(r.Context(), c.UserID, id.String(), "enterprise.create", "enterprise", id.String(), "", clientIP(r), map[string]any{
		"admin_user_id": adminUserID,
	})
	writeJSON(w, 201, map[string]any{
		"id": id.String(), "invite_code": req.InviteCode,
		"admin_user_id": adminUserID, "admin_username": uname,
	})
}

func (s *Server) handleAdminUsers(w http.ResponseWriter, r *http.Request) {
	c := s.requirePerm(w, r, permAdminRead)
	if c == nil {
		return
	}
	where := "TRUE"
	args := []any{}
	if !isPlatformAdminRole(c.Role) {
		args = append(args, c.EnterpriseID)
		where = "u.enterprise_id=$1"
	}
	if q := strings.TrimSpace(r.URL.Query().Get("q")); q != "" {
		args = append(args, "%"+escapeLike(q)+"%")
		where += fmt.Sprintf(
			` AND (u.phone ILIKE $%[1]d ESCAPE '\' OR u.username ILIKE $%[1]d ESCAPE '\' OR u.display_name ILIKE $%[1]d ESCAPE '\')`,
			len(args))
	}

	var total int
	if err := s.db.QueryRow(r.Context(), `
		SELECT COUNT(*) FROM users u WHERE `+where, args...).Scan(&total); err != nil {
		writeErr(w, 500, "query failed")
		return
	}

	limit, offset := adminListRange(r)
	args = append(args, limit, offset)
	rows, err := s.db.Query(r.Context(), fmt.Sprintf(`
		SELECT u.id::text, u.phone, u.username, u.display_name, u.role, u.banned,
		       u.register_ip, u.register_region, u.created_at,
		       COALESCE(u.enterprise_id::text,''), COALESCE(e.name,'')
		FROM users u
		LEFT JOIN enterprises e ON e.id = u.enterprise_id
		WHERE %s
		ORDER BY u.created_at DESC LIMIT $%d OFFSET $%d`,
		where, len(args)-1, len(args)), args...)
	if err != nil {
		writeErr(w, 500, "query failed")
		return
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, phone, un, dn, role, rip, rreg, eid, ename string
		var banned bool
		var created any
		_ = rows.Scan(&id, &phone, &un, &dn, &role, &banned, &rip, &rreg, &created, &eid, &ename)
		row := map[string]any{
			"id": id, "phone": phone, "username": un, "display_name": dn, "role": role,
			"banned": banned, "register_ip": rip, "register_region": rreg, "created_at": created,
		}
		if eid != "" {
			row["enterprise_id"] = eid
		}
		if ename != "" {
			row["enterprise_name"] = ename
		}
		out = append(out, row)
	}
	if out == nil {
		out = []map[string]any{}
	}
	writeJSON(w, 200, map[string]any{"users": out, "total": total, "limit": limit, "offset": offset})
}

// handleAdminGroups lists social groups in the operator's enterprise (read-only).
func (s *Server) handleAdminGroups(w http.ResponseWriter, r *http.Request) {
	c := s.requirePerm(w, r, permAdminRead)
	if c == nil {
		return
	}
	where := "conv.type='social_group'"
	args := []any{}
	if !isPlatformAdminRole(c.Role) {
		args = append(args, entArg(c.EnterpriseID))
		where += " AND conv.enterprise_id IS NOT DISTINCT FROM $1"
	}
	if q := strings.TrimSpace(r.URL.Query().Get("q")); q != "" {
		args = append(args, "%"+escapeLike(q)+"%")
		where += fmt.Sprintf(
			` AND (conv.title ILIKE $%[1]d ESCAPE '\' OR COALESCE(conv.public_id,'') ILIKE $%[1]d ESCAPE '\')`,
			len(args))
	}

	var total int
	if err := s.db.QueryRow(r.Context(), `
		SELECT COUNT(*) FROM conversations conv WHERE `+where, args...).Scan(&total); err != nil {
		writeErr(w, 500, "query failed")
		return
	}

	limit, offset := adminListRange(r)
	args = append(args, limit, offset)
	rows, err := s.db.Query(r.Context(), fmt.Sprintf(`
		SELECT conv.id::text,
		       COALESCE(conv.public_id, ''),
		       COALESCE(conv.title, ''),
		       COALESCE(conv.owner_id::text, ''),
		       COALESCE(ou.display_name, ''),
		       COALESCE(ou.username, ''),
		       (SELECT COUNT(*)::bigint FROM conversation_members cm
		         WHERE cm.conversation_id=conv.id AND cm.role <> 'pending'),
		       conv.created_at,
		       COALESCE(conv.is_enterprise_default, FALSE)
		FROM conversations conv
		LEFT JOIN users ou ON ou.id=conv.owner_id
		WHERE %s
		ORDER BY conv.created_at DESC
		LIMIT $%d OFFSET $%d`, where, len(args)-1, len(args)), args...)
	if err != nil {
		writeErr(w, 500, "query failed")
		return
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, publicID, title, ownerID, ownerDisplayName, ownerUsername string
		var memberCount int64
		var isEnterpriseDefault bool
		var created any
		if rows.Scan(&id, &publicID, &title, &ownerID, &ownerDisplayName, &ownerUsername, &memberCount, &created, &isEnterpriseDefault) != nil {
			continue
		}
		out = append(out, map[string]any{
			"id": id, "public_id": publicID, "title": title,
			"owner_id": ownerID, "owner_display_name": ownerDisplayName,
			"owner_username": ownerUsername,
			"member_count": memberCount, "created_at": created,
			"status": "active", "is_enterprise_default": isEnterpriseDefault,
		})
	}
	if out == nil {
		out = []map[string]any{}
	}
	writeJSON(w, 200, map[string]any{"groups": out, "total": total, "limit": limit, "offset": offset})
}

func (s *Server) adminSocialGroupAccessible(ctx context.Context, c *auth.Claims, convID string) (isEnterpriseDefault bool, err error) {
	q := `
		SELECT conv.type, COALESCE(conv.is_enterprise_default, FALSE)
		FROM conversations conv
		WHERE conv.id=$1
		  AND conv.type='social_group'`
	args := []any{convID}
	if !isPlatformAdminRole(c.Role) {
		args = append(args, entArg(c.EnterpriseID))
		q += ` AND conv.enterprise_id IS NOT DISTINCT FROM $2`
	}
	var typ string
	err = s.db.QueryRow(ctx, q, args...).Scan(&typ, &isEnterpriseDefault)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, errAdminUserNotFound
	}
	return isEnterpriseDefault, err
}

func (s *Server) handleAdminGetGroup(w http.ResponseWriter, r *http.Request) {
	c := s.requirePerm(w, r, permAdminRead)
	if c == nil {
		return
	}
	convID := strings.TrimSpace(r.PathValue("id"))
	if convID == "" {
		writeErr(w, 400, "group id required")
		return
	}
	isEnterpriseDefault, err := s.adminSocialGroupAccessible(r.Context(), c, convID)
	if errors.Is(err, errAdminUserNotFound) {
		writeErrCode(w, 404, "not_found", "group not found")
		return
	}
	if err != nil {
		writeErr(w, 500, "query failed")
		return
	}

	var title, description, publicID, ownerID, ownerDisplayName, ownerUsername string
	err = s.db.QueryRow(r.Context(), `
		SELECT COALESCE(conv.title, ''),
		       COALESCE(conv.description, ''),
		       COALESCE(conv.public_id, ''),
		       COALESCE(conv.owner_id::text, ''),
		       COALESCE(ou.display_name, ''),
		       COALESCE(ou.username, '')
		FROM conversations conv
		LEFT JOIN users ou ON ou.id = conv.owner_id
		WHERE conv.id=$1`, convID).Scan(&title, &description, &publicID, &ownerID, &ownerDisplayName, &ownerUsername)
	if err != nil {
		writeErrCode(w, 404, "not_found", "group not found")
		return
	}

	mrows, _ := s.db.Query(r.Context(), `
		SELECT u.id::text, u.username, COALESCE(u.display_name, ''), cm.role
		FROM conversation_members cm
		JOIN users u ON u.id = cm.user_id
		WHERE cm.conversation_id=$1 AND cm.role <> 'pending'
		ORDER BY CASE cm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.display_name`, convID)
	var members []map[string]any
	if mrows != nil {
		defer mrows.Close()
		for mrows.Next() {
			var uid, un, dn, role string
			if mrows.Scan(&uid, &un, &dn, &role) != nil {
				continue
			}
			members = append(members, map[string]any{
				"user_id": uid, "username": un, "display_name": dn, "role": role,
			})
		}
	}
	if members == nil {
		members = []map[string]any{}
	}

	writeJSON(w, 200, map[string]any{
		"id": convID, "title": title, "description": description, "public_id": publicID,
		"owner_id": ownerID, "owner_display_name": ownerDisplayName,
		"owner_username": ownerUsername,
		"status": "active", "is_enterprise_default": isEnterpriseDefault,
		"members": members,
	})
}

func (s *Server) handleAdminDeleteGroup(w http.ResponseWriter, r *http.Request) {
	c := s.requirePerm(w, r, permEnterpriseWrite)
	if c == nil {
		return
	}
	convID := strings.TrimSpace(r.PathValue("id"))
	if convID == "" {
		writeErr(w, 400, "group id required")
		return
	}
	isEnterpriseDefault, err := s.adminSocialGroupAccessible(r.Context(), c, convID)
	if errors.Is(err, errAdminUserNotFound) {
		writeErrCode(w, 404, "not_found", "group not found")
		return
	}
	if err != nil {
		writeErr(w, 500, "query failed")
		return
	}
	if isEnterpriseDefault {
		writeErrCode(w, 403, "forbidden", "enterprise default group cannot be deleted")
		return
	}

	memberIDs := s.memberIDsCtx(r.Context(), convID)
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
	s.audit(r.Context(), c.UserID, c.EnterpriseID, "group.delete", "conversation", convID, "admin_console", clientIP(r), nil)
	writeJSON(w, 200, map[string]any{"ok": true, "status": "deleted"})
}

func (s *Server) handleAdminRemoveGroupMember(w http.ResponseWriter, r *http.Request) {
	c := s.requirePerm(w, r, permEnterpriseWrite)
	if c == nil {
		return
	}
	convID := strings.TrimSpace(r.PathValue("id"))
	targetID := strings.TrimSpace(r.PathValue("userId"))
	if convID == "" || targetID == "" {
		writeErr(w, 400, "group id and user id required")
		return
	}
	if _, err := s.adminSocialGroupAccessible(r.Context(), c, convID); errors.Is(err, errAdminUserNotFound) {
		writeErrCode(w, 404, "not_found", "group not found")
		return
	} else if err != nil {
		writeErr(w, 500, "query failed")
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
	s.audit(r.Context(), c.UserID, c.EnterpriseID, "group.member_remove", "user", targetID, "admin_console", clientIP(r), map[string]any{
		"conversation_id": convID,
		"target_role":     targetRole,
	})
	s.hub.PublishToUsers([]string{targetID}, ws.Event{Type: "group.member_removed", Payload: payload})
	s.hub.PublishToUsers(s.adminIDs(r, convID), ws.Event{Type: "group.member_removed", Payload: payload})
	s.insertAdminMemberNotice(r, convID, c.UserID, targetID, "member_removed")
	writeJSON(w, 200, map[string]any{"ok": true})
}

// handleAdminCreateUser provisions a member without self-service registration.
// Platform admins may issue enterprise_admin accounts into a target enterprise via enterprise_id.
func (s *Server) handleAdminCreateUser(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	var req struct {
		Phone        string `json:"phone"`
		Password     string `json:"password"`
		Username     string `json:"username"`
		DisplayName  string `json:"display_name"`
		Role         string `json:"role"`
		EnterpriseID string `json:"enterprise_id"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	if !auth.ValidatePhone(req.Phone) {
		writeErr(w, 400, "phone must be 11 digits")
		return
	}
	if err := auth.ValidatePassword(req.Password); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	if !auth.ValidateUsername(req.Username) {
		writeErr(w, 400, "invalid username")
		return
	}
	role := req.Role
	if role == "" {
		role = roleMember
	}
	switch role {
	case roleMember:
		if s.requirePerm(w, r, permUsersCreateMember) == nil {
			return
		}
	case roleEnterpriseAdmin:
		if s.requirePerm(w, r, permIssueEnterpriseAdmin) == nil {
			return
		}
	default:
		writeErr(w, 400, "role must be member or enterprise_admin")
		return
	}

	entID := c.EnterpriseID
	if req.EnterpriseID != "" {
		if !isPlatformAdminRole(c.Role) {
			writeErrCode(w, 403, "forbidden", "only platform admin can target another enterprise")
			return
		}
		entID = strings.TrimSpace(req.EnterpriseID)
		var exists bool
		err := s.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM enterprises WHERE id=$1)`, entID).Scan(&exists)
		if err != nil || !exists {
			writeErrCode(w, 404, "enterprise_not_found", "enterprise not found")
			return
		}
	}
	if entID == "" {
		writeErrCode(w, 400, "no_enterprise", "enterprise required")
		return
	}

	display := strings.TrimSpace(req.DisplayName)
	if display == "" {
		display = req.Username
	}
	if err := auth.ValidateDisplayName(display); err != nil {
		writeErrFields(w, 400, "invalid_display_name", err.Error(), map[string]string{"display_name": err.Error()})
		return
	}
	if taken, err := s.displayNameTaken(r, display, ""); err != nil {
		writeErr(w, 500, "lookup failed")
		return
	} else if taken {
		writeErrFields(w, 409, "conflict", "display name already taken", map[string]string{"display_name": "already taken"})
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeErr(w, 500, "hash failed")
		return
	}
	uid := uuid.New()
	ip := clientIP(r)
	_, err = s.db.Exec(r.Context(), `
		INSERT INTO users(id, enterprise_id, phone, password_hash, username, display_name, role, register_ip, register_region)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		uid, entID, req.Phone, hash, req.Username, display, role, ip, guessRegion(ip))
	if err != nil {
		writeErr(w, 409, "phone or username already exists")
		return
	}
	s.audit(r.Context(), c.UserID, entID, "user.create", "user", uid.String(), "assisted registration", ip, map[string]any{"role": role})
	writeJSON(w, 201, map[string]any{
		"id": uid.String(), "phone": req.Phone, "username": req.Username, "display_name": display,
		"role": role, "enterprise_id": entID,
	})
}

func (s *Server) handleAdminBan(w http.ResponseWriter, r *http.Request) {
	c := s.requirePerm(w, r, permUsersBan)
	if c == nil {
		return
	}
	uid := r.PathValue("id")
	var req struct {
		Banned bool   `json:"banned"`
		Reason string `json:"reason"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	reason, ok := adminReason(w, req.Reason)
	if !ok {
		return
	}
	userEntID, managed, err := s.adminManagedUser(r.Context(), c, uid)
	if err != nil {
		writeErr(w, 500, "query failed")
		return
	}
	if !managed {
		writeErr(w, 404, "user not found")
		return
	}
	tag, err := s.db.Exec(r.Context(), `UPDATE users SET banned=$2 WHERE id=$1`, uid, req.Banned)
	if err != nil {
		writeErr(w, 400, "ban failed")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, 404, "user not found")
		return
	}
	if req.Banned {
		s.revokeUserSessions(r, uid, "banned")
	}
	s.audit(r.Context(), c.UserID, userEntID, "user.ban", "user", uid, reason, clientIP(r), map[string]any{"banned": req.Banned})
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) handleAdminResetPassword(w http.ResponseWriter, r *http.Request) {
	c := s.requirePerm(w, r, permUsersResetPassword)
	if c == nil {
		return
	}
	uid := r.PathValue("id")
	var req struct {
		Password string `json:"password"`
		Reason   string `json:"reason"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	reason, ok := adminReason(w, req.Reason)
	if !ok {
		return
	}
	if err := auth.ValidatePassword(req.Password); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeErr(w, 500, "hash failed")
		return
	}
	userEntID, managed, err := s.adminManagedUser(r.Context(), c, uid)
	if err != nil {
		writeErr(w, 500, "query failed")
		return
	}
	if !managed {
		writeErr(w, 404, "user not found")
		return
	}
	tag, err := s.db.Exec(r.Context(), `
		UPDATE users SET password_hash=$2, mfa_active=FALSE, mfa_secret=''
		WHERE id=$1`, uid, hash)
	if err != nil {
		writeErr(w, 400, "reset failed")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, 404, "user not found")
		return
	}
	s.clearMFARecoveryCodes(r.Context(), uid)
	s.revokeUserSessions(r, uid, "password_reset")
	s.audit(r.Context(), c.UserID, userEntID, "user.reset_password", "user", uid, reason, clientIP(r), nil)
	writeJSON(w, 200, map[string]any{"ok": true, "note": "password reset; existing password is never viewable"})
}

// resolveEnterpriseUserID maps an operator-supplied identifier to a user in
// entID. Accepts username, 11-digit phone, or UUID (legacy user_id).
func (s *Server) resolveEnterpriseUserID(ctx context.Context, entID, raw string) (uuid.UUID, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return uuid.Nil, errAdminUserInvalid
	}
	if id, err := uuid.Parse(raw); err == nil {
		var exists bool
		if err := s.db.QueryRow(ctx, `
			SELECT EXISTS(SELECT 1 FROM users WHERE id=$1 AND enterprise_id=$2)`,
			id, entID).Scan(&exists); err != nil {
			return uuid.Nil, err
		}
		if !exists {
			return uuid.Nil, errAdminUserNotFound
		}
		return id, nil
	}
	if auth.ValidatePhone(raw) {
		var id uuid.UUID
		err := s.db.QueryRow(ctx, `
			SELECT id FROM users WHERE phone=$1 AND enterprise_id=$2`,
			raw, entID).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, errAdminUserNotFound
		}
		return id, err
	}
	if !auth.ValidateUsername(raw) {
		return uuid.Nil, errAdminUserInvalid
	}
	var id uuid.UUID
	err := s.db.QueryRow(ctx, `
		SELECT id FROM users WHERE lower(username)=lower($1) AND enterprise_id=$2`,
		raw, entID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, errAdminUserNotFound
	}
	return id, err
}

func messageInspectReason(raw string) string {
	reason := strings.TrimSpace(raw)
	if len(reason) >= adminReasonMinLen {
		return reason
	}
	return adminInspectReasonEnterprise
}

func enterpriseMemberConvSQL(entArg int) string {
	return fmt.Sprintf(`m.conversation_id IN (
		SELECT cm.conversation_id FROM conversation_members cm
		JOIN users u ON u.id = cm.user_id
		WHERE u.enterprise_id = $%d::uuid
	)`, entArg)
}

const adminMessageListSQL = `
	SELECT m.id::text, m.conversation_id::text, m.sender_id::text,
	       COALESCE(u.username,''), COALESCE(u.display_name,''),
	       COALESCE(c.title,''), COALESCE(c.type,''),
	       COALESCE(c.enterprise_id::text,''), COALESCE(e.name,''),
	       m.body, m.type, COALESCE(m.media_url,''), m.recalled, m.created_at
	FROM messages m
	JOIN users u ON u.id = m.sender_id
	JOIN conversations c ON c.id = m.conversation_id
	LEFT JOIN enterprises e ON e.id = c.enterprise_id`

func normalizeAdminMessageScope(raw string) (string, bool) {
	scope := strings.ToLower(strings.TrimSpace(raw))
	if scope == "" {
		return "all", true
	}
	switch scope {
	case "all", "dm", "group":
		return scope, true
	default:
		return "", false
	}
}

func adminMessageScopeTypeSQL(scope string) string {
	switch scope {
	case "dm":
		return ` AND c.type = 'dm'`
	case "group":
		return ` AND c.type = 'social_group'`
	default:
		return ""
	}
}

func adminMessageGroupTitleSQL(argIndex int) string {
	return fmt.Sprintf(` AND c.title ILIKE $%d ESCAPE '\'`, argIndex)
}

func normalizeAdminMessageType(raw string) (string, bool) {
	typ := strings.ToLower(strings.TrimSpace(raw))
	if typ == "" || typ == "all" {
		return "", true
	}
	switch typ {
	case "text", "image", "file", "voice", "video", "system", "call":
		return typ, true
	default:
		return "", false
	}
}

func appendAdminMessageFilters(q string, args []any, msgType, textQ string) (string, []any) {
	if msgType != "" {
		args = append(args, msgType)
		q += fmt.Sprintf(` AND LOWER(m.type) = LOWER($%d)`, len(args))
	}
	if t := strings.TrimSpace(textQ); t != "" {
		args = append(args, "%"+escapeLike(t)+"%")
		q += fmt.Sprintf(` AND m.body ILIKE $%d ESCAPE '\'`, len(args))
	}
	return q, args
}

func scanAdminMessageRows(rows pgx.Rows) []map[string]any {
	var out []map[string]any
	for rows.Next() {
		var id, cid, sid, sun, sdn, title, ctype, cent, ename, body, typ, media string
		var recalled bool
		var created any
		if rows.Scan(&id, &cid, &sid, &sun, &sdn, &title, &ctype, &cent, &ename, &body, &typ, &media, &recalled, &created) != nil {
			continue
		}
		row := map[string]any{
			"id": id, "conversation_id": cid, "sender_id": sid,
			"sender_username": sun, "sender_display_name": sdn,
			"conversation_title": title, "conversation_type": ctype,
			"body": body, "type": typ, "recalled": recalled, "created_at": created,
		}
		if media != "" {
			row["media_url"] = media
		}
		if cent != "" {
			row["conversation_enterprise_id"] = cent
		}
		if ename != "" {
			row["enterprise_name"] = ename
		}
		out = append(out, row)
	}
	if out == nil {
		return []map[string]any{}
	}
	return out
}

func (s *Server) handleAdminMessages(w http.ResponseWriter, r *http.Request) {
	c := s.requirePerm(w, r, permMessagesInspect)
	if c == nil {
		return
	}
	reason := messageInspectReason(r.URL.Query().Get("reason"))

	scope, ok := normalizeAdminMessageScope(r.URL.Query().Get("scope"))
	if !ok {
		writeErrCode(w, 400, "invalid_scope", "scope must be all, dm, or group")
		return
	}
	scopeSQL := adminMessageScopeTypeSQL(scope)

	entID := c.EnterpriseID
	if rawEnt := strings.TrimSpace(r.URL.Query().Get("enterprise_id")); rawEnt != "" {
		if !isPlatformAdminRole(c.Role) {
			writeErrCode(w, 403, "forbidden", "only platform admin can set enterprise_id")
			return
		}
		if _, err := uuid.Parse(rawEnt); err != nil {
			writeErrCode(w, 400, "invalid_enterprise", "enterprise_id must be a valid uuid")
			return
		}
		entID = rawEnt
	}
	if entID == "" {
		writeErr(w, 400, "enterprise scope required for message access")
		return
	}
	if _, err := uuid.Parse(entID); err != nil {
		writeErrCode(w, 400, "invalid_enterprise", "enterprise_id must be a valid uuid")
		return
	}

	// Prefer username/phone ("user"); keep user_id for older clients/tests.
	target := strings.TrimSpace(r.URL.Query().Get("user"))
	if target == "" {
		target = strings.TrimSpace(r.URL.Query().Get("username"))
	}
	if target == "" {
		target = strings.TrimSpace(r.URL.Query().Get("phone"))
	}
	if target == "" {
		target = strings.TrimSpace(r.URL.Query().Get("user_id"))
	}

	var convFilter *uuid.UUID
	if rawConv := strings.TrimSpace(r.URL.Query().Get("conversation_id")); rawConv != "" {
		parsed, err := uuid.Parse(rawConv)
		if err != nil {
			writeErrCode(w, 400, "invalid_conversation", "conversation_id must be a valid uuid")
			return
		}
		convFilter = &parsed
	}

	groupName := strings.TrimSpace(r.URL.Query().Get("group"))
	if groupName == "" {
		groupName = strings.TrimSpace(r.URL.Query().Get("group_name"))
	}
	groupTitleArg := ""
	if groupName != "" {
		groupTitleArg = "%" + escapeLike(groupName) + "%"
	}

	msgType, ok := normalizeAdminMessageType(r.URL.Query().Get("message_type"))
	if !ok {
		msgType, ok = normalizeAdminMessageType(r.URL.Query().Get("type"))
	}
	if !ok {
		writeErrCode(w, 400, "invalid_message_type", "message_type must be text, image, file, voice, video, system, or call")
		return
	}
	textQ := strings.TrimSpace(r.URL.Query().Get("text"))
	if textQ == "" {
		textQ = strings.TrimSpace(r.URL.Query().Get("q"))
	}

	limit, offset := adminListRange(r)

	auditTargetType := "enterprise"
	auditTargetID := entID
	var total int
	var rows pgx.Rows
	var err error

	if target == "" {
		entConvSQL := enterpriseMemberConvSQL(1)
		countQ := `SELECT COUNT(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE ` + entConvSQL + scopeSQL
		countArgs := []any{entID}
		listQ := adminMessageListSQL + ` WHERE ` + entConvSQL + scopeSQL
		listArgs := []any{entID}
		if convFilter != nil {
			countQ += ` AND m.conversation_id=$2`
			countArgs = append(countArgs, *convFilter)
			listQ += ` AND m.conversation_id=$2`
			listArgs = append(listArgs, *convFilter)
		}
		if groupTitleArg != "" {
			n := len(countArgs) + 1
			countQ += adminMessageGroupTitleSQL(n)
			countArgs = append(countArgs, groupTitleArg)
			n = len(listArgs) + 1
			listQ += adminMessageGroupTitleSQL(n)
			listArgs = append(listArgs, groupTitleArg)
		}
		countQ, countArgs = appendAdminMessageFilters(countQ, countArgs, msgType, textQ)
		listQ, listArgs = appendAdminMessageFilters(listQ, listArgs, msgType, textQ)
		if err := s.db.QueryRow(r.Context(), countQ, countArgs...).Scan(&total); err != nil {
			writeErr(w, 500, "query failed")
			return
		}
		listArgs = append(listArgs, limit, offset)
		listQ += fmt.Sprintf(` ORDER BY m.created_at DESC LIMIT $%d OFFSET $%d`, len(listArgs)-1, len(listArgs))
		rows, err = s.db.Query(r.Context(), listQ, listArgs...)
	} else {
		userID, resolveErr := s.resolveEnterpriseUserID(r.Context(), entID, target)
		if errors.Is(resolveErr, errAdminUserNotFound) {
			writeErr(w, 404, "user not found")
			return
		}
		if errors.Is(resolveErr, errAdminUserInvalid) {
			writeErr(w, 400, "username or phone required for message access")
			return
		}
		if resolveErr != nil {
			writeErr(w, 500, "query failed")
			return
		}
		auditTargetType = "user"
		auditTargetID = userID.String()

		// Membership-scoped inspect (not message.enterprise_id alone).
		memberConvSQL := `m.conversation_id IN (
			SELECT conversation_id FROM conversation_members WHERE user_id=$1
		)`
		countQ := `SELECT COUNT(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE ` + memberConvSQL + scopeSQL
		countArgs := []any{userID}
		listQ := adminMessageListSQL + ` WHERE ` + memberConvSQL + scopeSQL
		listArgs := []any{userID}
		if convFilter != nil {
			countQ += ` AND m.conversation_id=$2`
			countArgs = append(countArgs, *convFilter)
			listQ += ` AND m.conversation_id=$2`
			listArgs = append(listArgs, *convFilter)
		}
		if groupTitleArg != "" {
			n := len(countArgs) + 1
			countQ += adminMessageGroupTitleSQL(n)
			countArgs = append(countArgs, groupTitleArg)
			n = len(listArgs) + 1
			listQ += adminMessageGroupTitleSQL(n)
			listArgs = append(listArgs, groupTitleArg)
		}
		countQ, countArgs = appendAdminMessageFilters(countQ, countArgs, msgType, textQ)
		listQ, listArgs = appendAdminMessageFilters(listQ, listArgs, msgType, textQ)
		if err := s.db.QueryRow(r.Context(), countQ, countArgs...).Scan(&total); err != nil {
			writeErr(w, 500, "query failed")
			return
		}
		listArgs = append(listArgs, limit, offset)
		listQ += fmt.Sprintf(` ORDER BY m.created_at DESC LIMIT $%d OFFSET $%d`, len(listArgs)-1, len(listArgs))
		rows, err = s.db.Query(r.Context(), listQ, listArgs...)
	}
	if err != nil {
		writeErr(w, 500, "query failed")
		return
	}
	defer rows.Close()
	out := scanAdminMessageRows(rows)
	meta := map[string]any{
		"count": len(out), "total": total, "limit": limit, "offset": offset,
		"scope": scope, "enterprise_id": entID,
	}
	if target != "" {
		meta["user"] = target
	}
	if convFilter != nil {
		meta["conversation_id"] = convFilter.String()
	}
	if groupName != "" {
		meta["group"] = groupName
	}
	if msgType != "" {
		meta["message_type"] = msgType
	}
	if textQ != "" {
		meta["text"] = textQ
	}
	s.audit(r.Context(), c.UserID, entID, "messages.inspect", auditTargetType, auditTargetID, reason, clientIP(r), meta)
	writeJSON(w, 200, map[string]any{
		"messages": out, "total": total, "limit": limit, "offset": offset,
		"has_more": offset+len(out) < total, "scope": scope,
	})
}

func (s *Server) handleAdminAudits(w http.ResponseWriter, r *http.Request) {
	c := s.requirePerm(w, r, permAdminRead)
	if c == nil {
		return
	}

	args := []any{normalizeRole(c.Role), c.EnterpriseID}
	where := `($1 = 'platform_admin' OR a.enterprise_id = $2::uuid)` + userLogSQLFilter

	if q := strings.TrimSpace(r.URL.Query().Get("q")); q != "" {
		args = append(args, "%"+escapeLike(q)+"%")
		n := len(args)
		where += fmt.Sprintf(
			` AND (a.action ILIKE $%d ESCAPE '\' OR a.ip ILIKE $%d ESCAPE '\' OR COALESCE(u.username,'') ILIKE $%d ESCAPE '\' OR COALESCE(u.phone,'') ILIKE $%d ESCAPE '\' OR COALESCE(u.display_name,'') ILIKE $%d ESCAPE '\')`,
			n, n, n, n, n)
	}
	if action := strings.TrimSpace(r.URL.Query().Get("action")); action != "" {
		args = append(args, action)
		where += fmt.Sprintf(` AND a.action = $%d`, len(args))
	}

	var total int
	if err := s.db.QueryRow(r.Context(), `
		SELECT COUNT(*)
		FROM audit_logs a
		LEFT JOIN users u ON u.id = a.actor_id
		WHERE `+where, args...).Scan(&total); err != nil {
		writeErr(w, 500, "query failed")
		return
	}

	limit, offset := adminListRange(r)
	listArgs := append(append([]any{}, args...), limit, offset)
	nLimit := len(listArgs) - 1
	nOffset := len(listArgs)
	rows, err := s.db.Query(r.Context(), fmt.Sprintf(`
		SELECT a.id::text,
		       COALESCE(NULLIF(u.display_name,''), NULLIF(u.username,''), NULLIF(u.phone,''), a.actor_id::text, ''),
		       a.action, a.reason, a.ip, a.meta, a.created_at
		FROM audit_logs a
		LEFT JOIN users u ON u.id = a.actor_id
		WHERE %s
		ORDER BY a.created_at DESC
		LIMIT $%d OFFSET $%d`, where, nLimit, nOffset), listArgs...)
	if err != nil {
		writeErr(w, 500, "query failed")
		return
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, actor, action, reason, ip string
		var metaRaw []byte
		var created any
		if rows.Scan(&id, &actor, &action, &reason, &ip, &metaRaw, &created) != nil {
			continue
		}
		meta := parseAuditMeta(metaRaw)
		platform := auditPlatformCategory(action, reason, meta)
		location := auditLogLocation(ip, meta)
		out = append(out, map[string]any{
			"id":         id,
			"actor":      actor,
			"action":     action,
			"platform":   platform,
			"ip":         ip,
			"location":   location,
			"created_at": created,
		})
	}
	if out == nil {
		out = []map[string]any{}
	}

	actionRows, err := s.db.Query(r.Context(), `
		SELECT DISTINCT action FROM audit_logs a
		WHERE ($1 = 'platform_admin' OR a.enterprise_id = $2::uuid)`+userLogSQLFilter+`
		ORDER BY action`, normalizeRole(c.Role), c.EnterpriseID)
	actions := []string{}
	if err == nil {
		for actionRows.Next() {
			var act string
			if actionRows.Scan(&act) == nil && act != "" {
				actions = append(actions, act)
			}
		}
		actionRows.Close()
	}

	writeJSON(w, 200, map[string]any{
		"logs": out, "audits": out, "total": total, "limit": limit, "offset": offset, "actions": actions,
	})
}
