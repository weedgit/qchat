package server

import (
	"context"
	"net/http"
	"strings"

	"github.com/google/uuid"
)

// loadEnterpriseAllowlistCIDRs returns CIDR strings for an enterprise.
// Empty slice means the allowlist policy is disabled.
func (s *Server) loadEnterpriseAllowlistCIDRs(ctx context.Context, enterpriseID string) ([]string, error) {
	if enterpriseID == "" {
		return nil, nil
	}
	rows, err := s.db.Query(ctx, `
		SELECT cidr FROM admin_ip_allowlist WHERE enterprise_id=$1 ORDER BY created_at`, enterpriseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var cidr string
		if rows.Scan(&cidr) != nil {
			continue
		}
		out = append(out, cidr)
	}
	return out, nil
}

// verifyLoginIPAllowlist enforces per-enterprise admin IP allowlists when configured.
func (s *Server) verifyLoginIPAllowlist(w http.ResponseWriter, r *http.Request, uid, entID, role string) bool {
	if !isAdminRole(role) || entID == "" {
		return true
	}
	cidrs, err := s.loadEnterpriseAllowlistCIDRs(r.Context(), entID)
	if err != nil {
		writeErrCode(w, 500, "allowlist_failed", "could not check IP allowlist")
		return false
	}
	if len(cidrs) == 0 {
		return true
	}
	ip := clientIP(r)
	if ipAllowedByList(ip, cidrs) {
		return true
	}
	s.audit(r.Context(), uid, entID, "user.login_denied_ip", "user", uid, "", ip, map[string]any{
		"reason": "ip_not_allowed",
	})
	writeErrCode(w, 403, "ip_not_allowed", "login not allowed from this IP address")
	return false
}

func (s *Server) handleAdminIPAllowlistList(w http.ResponseWriter, r *http.Request) {
	c := s.requirePerm(w, r, permAdminRead)
	if c == nil {
		return
	}
	if c.EnterpriseID == "" {
		writeErrCode(w, 400, "no_enterprise", "administrator has no enterprise")
		return
	}
	rows, err := s.db.Query(r.Context(), `
		SELECT id::text, cidr, COALESCE(label,''), COALESCE(created_by::text,''), created_at
		FROM admin_ip_allowlist
		WHERE enterprise_id=$1
		ORDER BY created_at`, c.EnterpriseID)
	if err != nil {
		writeErrCode(w, 500, "query_failed", "query failed")
		return
	}
	defer rows.Close()
	var entries []map[string]any
	for rows.Next() {
		var id, cidr, label, createdBy string
		var created any
		if rows.Scan(&id, &cidr, &label, &createdBy, &created) != nil {
			continue
		}
		entries = append(entries, map[string]any{
			"id": id, "cidr": cidr, "label": label,
			"created_by": createdBy, "created_at": created,
		})
	}
	if entries == nil {
		entries = []map[string]any{}
	}
	writeJSON(w, 200, map[string]any{
		"entries":  entries,
		"enforced": len(entries) > 0,
	})
}

func (s *Server) handleAdminIPAllowlistAdd(w http.ResponseWriter, r *http.Request) {
	c := s.requirePerm(w, r, permSecurityWrite)
	if c == nil {
		return
	}
	if c.EnterpriseID == "" {
		writeErrCode(w, 400, "no_enterprise", "administrator has no enterprise")
		return
	}
	var req struct {
		CIDR  string `json:"cidr"`
		Label string `json:"label"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErrCode(w, 400, "invalid_json", "invalid json")
		return
	}
	cidr, err := normalizeCIDR(req.CIDR)
	if err != nil {
		writeErrCode(w, 400, "invalid_cidr", err.Error())
		return
	}
	label := strings.TrimSpace(req.Label)
	if len([]rune(label)) > 120 {
		writeErrCode(w, 400, "invalid_label", "label too long")
		return
	}
	id := uuid.New()
	_, err = s.db.Exec(r.Context(), `
		INSERT INTO admin_ip_allowlist (id, enterprise_id, cidr, label, created_by)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (enterprise_id, cidr) DO NOTHING`,
		id, c.EnterpriseID, cidr, label, c.UserID)
	if err != nil {
		writeErrCode(w, 500, "create_failed", "could not add allowlist entry")
		return
	}
	// If conflict, look up existing id.
	var storedID string
	_ = s.db.QueryRow(r.Context(), `
		SELECT id::text FROM admin_ip_allowlist WHERE enterprise_id=$1 AND cidr=$2`,
		c.EnterpriseID, cidr).Scan(&storedID)
	s.audit(r.Context(), c.UserID, c.EnterpriseID, "admin.ip_allowlist_add", "cidr", cidr, "", clientIP(r), map[string]any{
		"label": label,
	})
	writeJSON(w, 201, map[string]any{
		"id": storedID, "cidr": cidr, "label": label,
	})
}

func (s *Server) handleAdminIPAllowlistDelete(w http.ResponseWriter, r *http.Request) {
	c := s.requirePerm(w, r, permSecurityWrite)
	if c == nil {
		return
	}
	if c.EnterpriseID == "" {
		writeErrCode(w, 400, "no_enterprise", "administrator has no enterprise")
		return
	}
	entryID := r.PathValue("id")
	if entryID == "" {
		writeErrCode(w, 400, "invalid_request", "id required")
		return
	}
	var cidr string
	err := s.db.QueryRow(r.Context(), `
		DELETE FROM admin_ip_allowlist
		WHERE id=$1 AND enterprise_id=$2
		RETURNING cidr`, entryID, c.EnterpriseID).Scan(&cidr)
	if err != nil {
		writeErrCode(w, 404, "not_found", "allowlist entry not found")
		return
	}
	s.audit(r.Context(), c.UserID, c.EnterpriseID, "admin.ip_allowlist_remove", "cidr", cidr, "", clientIP(r), nil)
	writeJSON(w, 200, map[string]any{"ok": true, "id": entryID})
}
