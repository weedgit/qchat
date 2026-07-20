package server

import (
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/qchat/qchat/services/api/internal/auth"
)

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
		Name              string `json:"name"`
		InviteCode        string `json:"invite_code"`
		AdminPhone        string `json:"admin_phone"`
		AdminPassword     string `json:"admin_password"`
		AdminUsername     string `json:"admin_username"`
	}
	if err := decodeJSON(r, &req); err != nil || req.Name == "" {
		writeErr(w, 400, "name required")
		return
	}
	if req.InviteCode == "" {
		req.InviteCode = strings.ToUpper(uuid.NewString()[:8])
	}
	id := uuid.New()
	_, err := s.db.Exec(r.Context(), `INSERT INTO enterprises(id, name, invite_code) VALUES ($1,$2,$3)`, id, req.Name, req.InviteCode)
	if err != nil {
		writeErr(w, 409, "create failed")
		return
	}
	if req.AdminPhone != "" && req.AdminPassword != "" {
		if err := auth.ValidatePassword(req.AdminPassword); err != nil {
			writeErr(w, 400, err.Error())
			return
		}
		hash, _ := auth.HashPassword(req.AdminPassword)
		uname := req.AdminUsername
		if uname == "" {
			uname = "admin_" + req.InviteCode
		}
		_, _ = s.db.Exec(r.Context(), `
			INSERT INTO users(enterprise_id, phone, password_hash, username, display_name, role)
			VALUES ($1,$2,$3,$4,$4,'enterprise_admin')`, id, req.AdminPhone, hash, uname)
	}
	s.audit(r.Context(), c.UserID, id.String(), "enterprise.create", "enterprise", id.String(), "", clientIP(r), nil)
	writeJSON(w, 201, map[string]any{"id": id.String(), "invite_code": req.InviteCode})
}

func (s *Server) handleAdminUsers(w http.ResponseWriter, r *http.Request) {
	c := s.requireAdmin(w, r)
	if c == nil {
		return
	}
	rows, err := s.db.Query(r.Context(), `
		SELECT id::text, phone, username, display_name, role, banned, register_ip, register_region, created_at
		FROM users WHERE enterprise_id=$1 ORDER BY created_at DESC LIMIT 200`, c.EnterpriseID)
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
	writeJSON(w, 200, map[string]any{"users": out})
}

// handleAdminCreateUser provisions a member without self-service SMS (Mattermost CreateUser / assisted registration).
func (s *Server) handleAdminCreateUser(w http.ResponseWriter, r *http.Request) {
	c := s.requireAdmin(w, r)
	if c == nil {
		return
	}
	var req struct {
		Phone       string `json:"phone"`
		Password    string `json:"password"`
		Username    string `json:"username"`
		DisplayName string `json:"display_name"`
		Role        string `json:"role"`
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
		uid, c.EnterpriseID, req.Phone, hash, req.Username, display, role, ip, guessRegion(ip))
	if err != nil {
		writeErr(w, 409, "phone or username already exists")
		return
	}
	s.audit(r.Context(), c.UserID, c.EnterpriseID, "user.create", "user", uid.String(), "assisted registration", ip, map[string]any{"role": role})
	writeJSON(w, 201, map[string]any{
		"id": uid.String(), "phone": req.Phone, "username": req.Username, "display_name": display, "role": role,
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
	_, err := s.db.Exec(r.Context(), `UPDATE users SET banned=$3 WHERE id=$1 AND enterprise_id=$2`, uid, c.EnterpriseID, req.Banned)
	if err != nil {
		writeErr(w, 400, "ban failed")
		return
	}
	if req.Banned {
		_, _ = s.db.Exec(r.Context(), `UPDATE sessions SET revoked=TRUE WHERE user_id=$1`, uid)
	}
	s.audit(r.Context(), c.UserID, c.EnterpriseID, "user.ban", "user", uid, req.Reason, clientIP(r), map[string]any{"banned": req.Banned})
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
	if err := auth.ValidatePassword(req.Password); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeErr(w, 500, "hash failed")
		return
	}
	_, err = s.db.Exec(r.Context(), `UPDATE users SET password_hash=$3 WHERE id=$1 AND enterprise_id=$2`, uid, c.EnterpriseID, hash)
	if err != nil {
		writeErr(w, 400, "reset failed")
		return
	}
	_, _ = s.db.Exec(r.Context(), `UPDATE sessions SET revoked=TRUE WHERE user_id=$1`, uid)
	s.audit(r.Context(), c.UserID, c.EnterpriseID, "user.reset_password", "user", uid, req.Reason, clientIP(r), nil)
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
	userID := r.URL.Query().Get("user_id")
	rows, err := s.db.Query(r.Context(), `
		SELECT m.id::text, m.conversation_id::text, m.sender_id::text, m.body, m.type, m.created_at
		FROM messages m
		WHERE m.enterprise_id=$1 AND ($2='' OR m.sender_id=$2::uuid)
		ORDER BY m.created_at DESC LIMIT 100`, c.EnterpriseID, userID)
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
	s.audit(r.Context(), c.UserID, c.EnterpriseID, "messages.inspect", "user", userID, reason, clientIP(r), map[string]any{"count": len(out)})
	writeJSON(w, 200, map[string]any{"messages": out})
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

