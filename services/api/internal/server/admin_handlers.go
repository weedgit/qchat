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
)

var (
	errAdminUserNotFound = errors.New("user not found")
	errAdminUserInvalid  = errors.New("invalid user identifier")
)

const (
	adminUsersDefaultLimit = 50
	adminUsersMaxLimit     = 200
	// adminReasonMinLen matches the message-inspect gate: every audited action
	// against a user account must carry a usable justification.
	adminReasonMinLen = 8
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
	q := `SELECT id::text, name, invite_code, invite_active, retention_days, created_at FROM enterprises`
	args := []any{}
	if c.Role != "platform_owner" {
		q += ` WHERE id=$1`
		args = append(args, c.EnterpriseID)
	}
	q += ` ORDER BY created_at DESC`
	rows, err := s.db.Query(r.Context(), q, args...)
	if err != nil {
		writeErr(w, 500, "query failed")
		return
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, name, code string
		var active bool
		var days int
		var created any
		_ = rows.Scan(&id, &name, &code, &active, &days, &created)
		out = append(out, map[string]any{"id": id, "name": name, "invite_code": code, "invite_active": active, "retention_days": days, "created_at": created})
	}
	if out == nil {
		out = []map[string]any{}
	}
	writeJSON(w, 200, map[string]any{"enterprises": out})
}

func (s *Server) handleAdminCreateEnterprise(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	if c.Role != "platform_owner" {
		writeErr(w, 403, "forbidden")
		return
	}
	var req struct {
		Name          string `json:"name"`
		InviteCode    string `json:"invite_code"`
		AdminPhone    string `json:"admin_phone"`
		AdminPassword string `json:"admin_password"`
		AdminUsername string `json:"admin_username"`
	}
	if err := decodeJSON(r, &req); err != nil || strings.TrimSpace(req.Name) == "" {
		writeErrCode(w, 400, "invalid_request", "name required")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
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
	if _, err := tx.Exec(r.Context(), `INSERT INTO enterprises(id, name, invite_code) VALUES ($1,$2,$3)`, id, req.Name, req.InviteCode); err != nil {
		writeErrCode(w, 409, "create_failed", "create failed")
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
	where := "u.enterprise_id=$1"
	args := []any{c.EnterpriseID}
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
	where := "conv.type='social_group' AND conv.enterprise_id IS NOT DISTINCT FROM $1"
	args := []any{entArg(c.EnterpriseID)}
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
		       COALESCE(ou.display_name, ou.username, ''),
		       (SELECT COUNT(*)::bigint FROM conversation_members cm
		         WHERE cm.conversation_id=conv.id AND cm.role <> 'pending'),
		       conv.created_at
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
		var id, publicID, title, ownerID, ownerName string
		var memberCount int64
		var created any
		if rows.Scan(&id, &publicID, &title, &ownerID, &ownerName, &memberCount, &created) != nil {
			continue
		}
		out = append(out, map[string]any{
			"id": id, "public_id": publicID, "title": title,
			"owner_id": ownerID, "owner_display_name": ownerName,
			"member_count": memberCount, "created_at": created,
		})
	}
	if out == nil {
		out = []map[string]any{}
	}
	writeJSON(w, 200, map[string]any{"groups": out, "total": total, "limit": limit, "offset": offset})
}

// handleAdminCreateUser provisions a member without self-service registration (CreateUser / assisted registration).
// Platform owners may issue enterprise_admin accounts into a target enterprise via enterprise_id.
// Enterprise admins / platform owners may also issue compliance, support, and read_only console roles.
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
	case roleCompliance, roleSupport, roleReadOnly:
		if s.requirePerm(w, r, permUsersCreateSubrole) == nil {
			return
		}
	default:
		writeErr(w, 400, "role must be member, enterprise_admin, compliance, support, or read_only")
		return
	}

	entID := c.EnterpriseID
	if req.EnterpriseID != "" {
		if c.Role != rolePlatformOwner {
			writeErrCode(w, 403, "forbidden", "only platform owner can target another enterprise")
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
	tag, err := s.db.Exec(r.Context(), `UPDATE users SET banned=$3 WHERE id=$1 AND enterprise_id=$2`, uid, c.EnterpriseID, req.Banned)
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
	s.audit(r.Context(), c.UserID, c.EnterpriseID, "user.ban", "user", uid, reason, clientIP(r), map[string]any{"banned": req.Banned})
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
	tag, err := s.db.Exec(r.Context(), `
		UPDATE users SET password_hash=$3, mfa_active=FALSE, mfa_secret=''
		WHERE id=$1 AND enterprise_id=$2`, uid, c.EnterpriseID, hash)
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
	s.audit(r.Context(), c.UserID, c.EnterpriseID, "user.reset_password", "user", uid, reason, clientIP(r), nil)
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

func (s *Server) handleAdminMessages(w http.ResponseWriter, r *http.Request) {
	c := s.requirePerm(w, r, permMessagesInspect)
	if c == nil {
		return
	}
	reason := strings.TrimSpace(r.URL.Query().Get("reason"))
	if len(reason) < 8 {
		writeErr(w, 400, "reason required (≥8 chars) for message access")
		return
	}

	scope := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("scope")))
	if scope == "" {
		scope = "all"
	}
	if scope != "all" && scope != "sent" {
		writeErrCode(w, 400, "invalid_scope", "scope must be all or sent")
		return
	}

	entID := c.EnterpriseID
	if rawEnt := strings.TrimSpace(r.URL.Query().Get("enterprise_id")); rawEnt != "" {
		if c.Role != "platform_owner" {
			writeErrCode(w, 403, "forbidden", "only platform owner can set enterprise_id")
			return
		}
		if _, err := uuid.Parse(rawEnt); err != nil {
			writeErrCode(w, 400, "invalid_enterprise", "enterprise_id must be a valid uuid")
			return
		}
		entID = rawEnt
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
	if target == "" {
		writeErr(w, 400, "username or phone required for message access")
		return
	}
	userID, err := s.resolveEnterpriseUserID(r.Context(), entID, target)
	if errors.Is(err, errAdminUserNotFound) {
		writeErr(w, 404, "user not found")
		return
	}
	if errors.Is(err, errAdminUserInvalid) {
		writeErr(w, 400, "username or phone required for message access")
		return
	}
	if err != nil {
		writeErr(w, 500, "query failed")
		return
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

	limit, offset := adminListRange(r)

	// Membership-scoped inspect (not message.enterprise_id alone).
	// group joins, senders stamp their own tenant on rows — filtering by message
	// enterprise_id drops cross-tenant history the user actually saw.
	memberConvSQL := `m.conversation_id IN (
		SELECT conversation_id FROM conversation_members WHERE user_id=$1
	)`
	var total int
	var rows pgx.Rows
	if scope == "sent" {
		countQ := `SELECT COUNT(*) FROM messages m WHERE m.sender_id=$1 AND ` + memberConvSQL
		countArgs := []any{userID}
		listQ := `
			SELECT m.id::text, m.conversation_id::text, m.sender_id::text,
			       COALESCE(u.username,''), COALESCE(u.display_name,''),
			       COALESCE(c.title,''), COALESCE(c.type,''),
			       COALESCE(c.enterprise_id::text,''), COALESCE(e.name,''),
			       m.body, m.type, COALESCE(m.media_url,''), m.recalled, m.created_at
			FROM messages m
			JOIN users u ON u.id = m.sender_id
			JOIN conversations c ON c.id = m.conversation_id
			LEFT JOIN enterprises e ON e.id = c.enterprise_id
			WHERE m.sender_id=$1 AND ` + memberConvSQL
		listArgs := []any{userID}
		if convFilter != nil {
			countQ += ` AND m.conversation_id=$2`
			countArgs = append(countArgs, *convFilter)
			listQ += ` AND m.conversation_id=$2`
			listArgs = append(listArgs, *convFilter)
		}
		if err := s.db.QueryRow(r.Context(), countQ, countArgs...).Scan(&total); err != nil {
			writeErr(w, 500, "query failed")
			return
		}
		listArgs = append(listArgs, limit, offset)
		listQ += fmt.Sprintf(` ORDER BY m.created_at DESC LIMIT $%d OFFSET $%d`, len(listArgs)-1, len(listArgs))
		rows, err = s.db.Query(r.Context(), listQ, listArgs...)
	} else {
		countQ := `SELECT COUNT(*) FROM messages m WHERE ` + memberConvSQL
		countArgs := []any{userID}
		listQ := `
			SELECT m.id::text, m.conversation_id::text, m.sender_id::text,
			       COALESCE(u.username,''), COALESCE(u.display_name,''),
			       COALESCE(c.title,''), COALESCE(c.type,''),
			       COALESCE(c.enterprise_id::text,''), COALESCE(e.name,''),
			       m.body, m.type, COALESCE(m.media_url,''), m.recalled, m.created_at
			FROM messages m
			JOIN users u ON u.id = m.sender_id
			JOIN conversations c ON c.id = m.conversation_id
			LEFT JOIN enterprises e ON e.id = c.enterprise_id
			WHERE ` + memberConvSQL
		listArgs := []any{userID}
		if convFilter != nil {
			countQ += ` AND m.conversation_id=$2`
			countArgs = append(countArgs, *convFilter)
			listQ += ` AND m.conversation_id=$2`
			listArgs = append(listArgs, *convFilter)
		}
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
		out = []map[string]any{}
	}
	meta := map[string]any{
		"count": len(out), "total": total, "limit": limit, "offset": offset,
		"scope": scope, "enterprise_id": entID,
	}
	if convFilter != nil {
		meta["conversation_id"] = convFilter.String()
	}
	s.audit(r.Context(), c.UserID, entID, "messages.inspect", "user", userID.String(), reason, clientIP(r), meta)
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
	rows, err := s.db.Query(r.Context(), `
		SELECT id::text, actor_id::text, action, target_type, target_id, reason, ip, created_at
		FROM audit_logs WHERE enterprise_id=$1 OR $2='platform_owner'
		ORDER BY created_at DESC LIMIT 200`, c.EnterpriseID, c.Role)
	if err != nil {
		writeErr(w, 500, "query failed")
		return
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, actor, action, tt, tid, reason, ip string
		var created any
		_ = rows.Scan(&id, &actor, &action, &tt, &tid, &reason, &ip, &created)
		out = append(out, map[string]any{"id": id, "actor_id": actor, "action": action, "target_type": tt, "target_id": tid, "reason": reason, "ip": ip, "created_at": created})
	}
	if out == nil {
		out = []map[string]any{}
	}
	writeJSON(w, 200, map[string]any{"audits": out})
}
