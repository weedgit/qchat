package server

import (
	"context"
	"encoding/json"
	"net/http"
)

// recordAdminLoginAlerts writes audit rows when an administrator signs in from
// a device_id or IP that has never appeared on their prior sessions.
// First-ever login produces no alerts. Alerts do not block login.
func (s *Server) recordAdminLoginAlerts(
	ctx context.Context,
	uid, entID, role, ip, deviceID, deviceType, platform string,
) {
	if !isAdminRole(role) {
		return
	}
	var prior int
	if err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM sessions WHERE user_id=$1`, uid).Scan(&prior); err != nil || prior == 0 {
		return
	}
	meta := map[string]any{
		"device": deviceType, "device_id": deviceID, "platform": platform,
	}
	if deviceID != "" {
		var seen bool
		_ = s.db.QueryRow(ctx, `
			SELECT EXISTS(
				SELECT 1 FROM sessions
				WHERE user_id=$1 AND COALESCE(device_id,'')=$2 AND COALESCE(device_id,'')<>''
			)`, uid, deviceID).Scan(&seen)
		if !seen {
			s.audit(ctx, uid, entID, "admin.login_new_device", "user", uid, "", ip, meta)
		}
	}
	if ip != "" {
		var seen bool
		_ = s.db.QueryRow(ctx, `
			SELECT EXISTS(
				SELECT 1 FROM sessions
				WHERE user_id=$1 AND COALESCE(ip,'')=$2 AND COALESCE(ip,'')<>''
			)`, uid, ip).Scan(&seen)
		if !seen {
			s.audit(ctx, uid, entID, "admin.login_new_ip", "user", uid, "", ip, meta)
		}
	}
}

func (s *Server) handleAdminLoginAlerts(w http.ResponseWriter, r *http.Request) {
	c := s.requirePerm(w, r, permAdminRead)
	if c == nil {
		return
	}
	rows, err := s.db.Query(r.Context(), `
		SELECT a.id::text, COALESCE(a.actor_id::text,''), a.action, COALESCE(a.ip,''), a.meta, a.created_at,
		       COALESCE(u.username,''), COALESCE(u.display_name,'')
		FROM audit_logs a
		LEFT JOIN users u ON u.id = a.actor_id
		WHERE a.action IN ('admin.login_new_device', 'admin.login_new_ip', 'user.login_denied_ip')
		  AND (a.enterprise_id=$1 OR $2='platform_owner')
		ORDER BY a.created_at DESC
		LIMIT 50`, c.EnterpriseID, c.Role)
	if err != nil {
		writeErrCode(w, 500, "query_failed", "query failed")
		return
	}
	defer rows.Close()
	var alerts []map[string]any
	for rows.Next() {
		var id, actor, action, ip, username, display string
		var metaRaw []byte
		var created any
		if rows.Scan(&id, &actor, &action, &ip, &metaRaw, &created, &username, &display) != nil {
			continue
		}
		var meta any = map[string]any{}
		if len(metaRaw) > 0 {
			_ = json.Unmarshal(metaRaw, &meta)
		}
		alerts = append(alerts, map[string]any{
			"id": id, "actor_id": actor, "action": action, "ip": ip,
			"meta": meta, "created_at": created,
			"username": username, "display_name": display,
		})
	}
	if alerts == nil {
		alerts = []map[string]any{}
	}
	writeJSON(w, 200, map[string]any{"alerts": alerts})
}
