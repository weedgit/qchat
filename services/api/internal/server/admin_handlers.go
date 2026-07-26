package server

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/qchat/qchat/services/api/internal/auth"
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

func (s *Server) requireAdmin(w http.ResponseWriter, r *http.Request) *auth.Claims {
	c := claimsFrom(r)
	if c.Role != "enterprise_admin" && c.Role != "platform_owner" {
		writeErr(w, 403, "forbidden")
		return nil
	}
	return c
}

func (s *Server) handleAdminEnterprises(w http.ResponseWriter, r *http.Request) {
	c := s.requireAdmin(w, r)
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
	if _, err := s.ensureEnterpriseDefaultChat(r.Context(), id.String(), adminUserID); err != nil {
		writeErrCode(w, 500, "default_chat_failed", "default chat failed")
		return
	}
	s.audit(r.Context(), c.UserID, id.String(), "enterprise.create", "enterprise", id.String(), "", clientIP(r), map[string]any{
		"admin_user_id": adminUserID,
	})
	writeJSON(w, 201, map[string]any{
		"id": id.String(), "invite_code": req.InviteCode,
		"admin_user_id": adminUserID, "admin_username": uname,
	})
}

func (s *Server) handleAdminUsers(w http.ResponseWriter, r *http.Request) {
	c := s.requireAdmin(w, r)
	if c == nil {
		return
	}
	where := "enterprise_id=$1"
	args := []any{c.EnterpriseID}
	if q := strings.TrimSpace(r.URL.Query().Get("q")); q != "" {
		args = append(args, "%"+escapeLike(q)+"%")
		where += fmt.Sprintf(
			` AND (phone ILIKE $%[1]d ESCAPE '\' OR username ILIKE $%[1]d ESCAPE '\' OR display_name ILIKE $%[1]d ESCAPE '\')`,
			len(args))
	}

	var total int
	if err := s.db.QueryRow(r.Context(), `SELECT COUNT(*) FROM users WHERE `+where, args...).Scan(&total); err != nil {
		writeErr(w, 500, "query failed")
		return
	}

	limit, offset := adminListRange(r)
	args = append(args, limit, offset)
	rows, err := s.db.Query(r.Context(), fmt.Sprintf(`
		SELECT id::text, phone, username, display_name, role, banned, register_ip, register_region, created_at
		FROM users WHERE %s ORDER BY created_at DESC LIMIT $%d OFFSET $%d`,
		where, len(args)-1, len(args)), args...)
	if err != nil {
		writeErr(w, 500, "query failed")
		return
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, phone, un, dn, role, rip, rreg string
		var banned bool
		var created any
		_ = rows.Scan(&id, &phone, &un, &dn, &role, &banned, &rip, &rreg, &created)
		out = append(out, map[string]any{
			"id": id, "phone": phone, "username": un, "display_name": dn, "role": role,
			"banned": banned, "register_ip": rip, "register_region": rreg, "created_at": created,
		})
	}
	if out == nil {
		out = []map[string]any{}
	}
	writeJSON(w, 200, map[string]any{"users": out, "total": total, "limit": limit, "offset": offset})
}

// handleAdminCreateUser provisions a member without self-service SMS (CreateUser / assisted registration).
// Platform owners may issue enterprise_admin accounts into a target enterprise via enterprise_id.
func (s *Server) handleAdminCreateUser(w http.ResponseWriter, r *http.Request) {
	c := s.requireAdmin(w, r)
	if c == nil {
		return
	}
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
		role = "member"
	}
	if role != "member" && role != "enterprise_admin" {
		writeErr(w, 400, "role must be member or enterprise_admin")
		return
	}
	// Permission matrix: only platform_owner issues enterprise administrator accounts.
	if role == "enterprise_admin" && c.Role != "platform_owner" {
		writeErrCode(w, 403, "forbidden", "only platform owner can issue enterprise admins")
		return
	}

	entID := c.EnterpriseID
	if req.EnterpriseID != "" {
		if c.Role != "platform_owner" {
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

	display := req.DisplayName
	if display == "" {
		display = req.Username
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
	_ = s.addUserToEnterpriseDefaultChat(r.Context(), entID, uid.String())
	s.audit(r.Context(), c.UserID, entID, "user.create", "user", uid.String(), "assisted registration", ip, map[string]any{"role": role})
	writeJSON(w, 201, map[string]any{
		"id": uid.String(), "phone": req.Phone, "username": req.Username, "display_name": display,
		"role": role, "enterprise_id": entID,
	})
}

func (s *Server) handleAdminBan(w http.ResponseWriter, r *http.Request) {
	c := s.requireAdmin(w, r)
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
	c := s.requireAdmin(w, r)
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
	s.revokeUserSessions(r, uid, "password_reset")
	s.audit(r.Context(), c.UserID, c.EnterpriseID, "user.reset_password", "user", uid, reason, clientIP(r), nil)
	writeJSON(w, 200, map[string]any{"ok": true, "note": "password reset; existing password is never viewable"})
}

func (s *Server) handleAdminMessages(w http.ResponseWriter, r *http.Request) {
	c := s.requireAdmin(w, r)
	if c == nil {
		return
	}
	reason := strings.TrimSpace(r.URL.Query().Get("reason"))
	if len(reason) < 8 {
		writeErr(w, 400, "reason required (≥8 chars) for message access")
		return
	}
	// A specific user must be named: an empty target would dump the whole
	// enterprise under a single audit entry. Validate the UUID here so a bad
	// value is a clear 400 rather than a SQL cast 500.
	userID, err := uuid.Parse(strings.TrimSpace(r.URL.Query().Get("user_id")))
	if err != nil {
		writeErr(w, 400, "user_id required (valid user id) for message access")
		return
	}
	var exists bool
	if err := s.db.QueryRow(r.Context(), `
		SELECT EXISTS(SELECT 1 FROM users WHERE id=$1 AND enterprise_id=$2)`,
		userID, c.EnterpriseID).Scan(&exists); err != nil {
		writeErr(w, 500, "query failed")
		return
	}
	if !exists {
		writeErr(w, 404, "user not found")
		return
	}

	limit, offset := adminListRange(r)
	var total int
	if err := s.db.QueryRow(r.Context(), `
		SELECT COUNT(*) FROM messages
		WHERE enterprise_id=$1 AND sender_id=$2`, c.EnterpriseID, userID).Scan(&total); err != nil {
		writeErr(w, 500, "query failed")
		return
	}
	rows, err := s.db.Query(r.Context(), `
		SELECT m.id::text, m.conversation_id::text, m.sender_id::text, m.body, m.type, m.created_at
		FROM messages m
		WHERE m.enterprise_id=$1 AND m.sender_id=$2
		ORDER BY m.created_at DESC
		LIMIT $3 OFFSET $4`, c.EnterpriseID, userID, limit, offset)
	if err != nil {
		writeErr(w, 500, "query failed")
		return
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, cid, sid, body, typ string
		var created any
		_ = rows.Scan(&id, &cid, &sid, &body, &typ, &created)
		out = append(out, map[string]any{"id": id, "conversation_id": cid, "sender_id": sid, "body": body, "type": typ, "created_at": created})
	}
	if out == nil {
		out = []map[string]any{}
	}
	s.audit(r.Context(), c.UserID, c.EnterpriseID, "messages.inspect", "user", userID.String(), reason, clientIP(r), map[string]any{
		"count": len(out), "total": total, "limit": limit, "offset": offset,
	})
	writeJSON(w, 200, map[string]any{
		"messages": out, "total": total, "limit": limit, "offset": offset,
		"has_more": offset+len(out) < total,
	})
}

func (s *Server) handleAdminAudits(w http.ResponseWriter, r *http.Request) {
	c := s.requireAdmin(w, r)
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
