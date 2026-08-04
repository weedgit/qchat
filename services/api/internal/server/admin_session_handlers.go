package server

import (
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const adminSessionRecentDays = 90
const adminSessionRecentLimit = 50

func adminSessionStatus(revoked bool, expiresAt time.Time) string {
	if revoked {
		return "revoked"
	}
	if time.Now().After(expiresAt) {
		return "expired"
	}
	return "active"
}

// handleAdminUserSessions lists active sessions for one user in the
// administrator's enterprise. It mirrors the self-service session view while
// deliberately omitting refresh-token material.
func (s *Server) handleAdminUserSessions(w http.ResponseWriter, r *http.Request) {
	c := s.requirePerm(w, r, permAdminRead)
	if c == nil {
		return
	}
	userID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeErr(w, 400, "invalid user id")
		return
	}

	_, managed, err := s.adminManagedUser(r.Context(), c, userID.String())
	if err != nil {
		writeErr(w, 500, "query failed")
		return
	}
	if !managed {
		writeErr(w, 404, "user not found")
		return
	}

	var totalEver int
	if err := s.db.QueryRow(r.Context(), `
		SELECT COUNT(*) FROM sessions WHERE user_id=$1`, userID).Scan(&totalEver); err != nil {
		writeErr(w, 500, "query failed")
		return
	}

	recentCutoff := time.Now().AddDate(0, 0, -adminSessionRecentDays)
	rows, err := s.db.Query(r.Context(), `
		SELECT id::text, device_type, COALESCE(device_name,''), COALESCE(device_id,''),
		       COALESCE(platform,''), COALESCE(ip,''), COALESCE(ip_region,''),
		       COALESCE(user_agent,''), created_at, expires_at, revoked,
		       COALESCE(last_active_at, created_at)
		FROM sessions
		WHERE user_id=$1 AND created_at >= $2
		ORDER BY
		  CASE WHEN revoked=FALSE AND expires_at>now() THEN 0 ELSE 1 END,
		  COALESCE(last_active_at, created_at) DESC
		LIMIT $3`, userID, recentCutoff, adminSessionRecentLimit)
	if err != nil {
		writeErr(w, 500, "query failed")
		return
	}
	defer rows.Close()

	out := []map[string]any{}
	for rows.Next() {
		var id, deviceType, deviceName, deviceID, platform, ip, region, userAgent string
		var createdAt, expiresAt, lastActiveAt time.Time
		var revoked bool
		if err := rows.Scan(
			&id, &deviceType, &deviceName, &deviceID, &platform, &ip, &region,
			&userAgent, &createdAt, &expiresAt, &revoked, &lastActiveAt,
		); err != nil {
			writeErr(w, 500, "query failed")
			return
		}
		status := adminSessionStatus(revoked, expiresAt)
		out = append(out, map[string]any{
			"id":             id,
			"device_type":    deviceType,
			"device_name":    deviceName,
			"device_id":      deviceID,
			"platform":       displayPlatform(platform, deviceName, deviceType, userAgent),
			"ip":             ip,
			"location":       formatSessionLocation(ip, region),
			"created_at":     createdAt.UTC(),
			"expires_at":     expiresAt.UTC(),
			"last_active_at": lastActiveAt.UTC(),
			"status":         status,
			"revocable":      status == "active",
		})
	}
	if err := rows.Err(); err != nil {
		writeErr(w, 500, "query failed")
		return
	}
	writeJSON(w, 200, map[string]any{
		"sessions":          out,
		"never_logged_in":   totalEver == 0,
		"recent_days":       adminSessionRecentDays,
		"active_count":      countSessionsByStatus(out, "active"),
	})
}

// handleAdminRevokeUserSession remotely signs out one active session. The
// tenant predicate is part of the UPDATE so a cross-enterprise session cannot
// be revoked even if its UUID is known.
func (s *Server) handleAdminRevokeUserSession(w http.ResponseWriter, r *http.Request) {
	c := s.requirePerm(w, r, permUsersRevokeSession)
	if c == nil {
		return
	}
	userID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeErr(w, 400, "invalid user id")
		return
	}
	sessionID, err := uuid.Parse(r.PathValue("sessionId"))
	if err != nil {
		writeErr(w, 400, "invalid session id")
		return
	}
	var req struct {
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

	userEntID, managed, err := s.adminManagedUser(r.Context(), c, userID.String())
	if err != nil {
		writeErr(w, 500, "query failed")
		return
	}
	if !managed {
		writeErr(w, 404, "user not found")
		return
	}

	var deviceType string
	err = s.db.QueryRow(r.Context(), `
		UPDATE sessions AS sess
		SET revoked=TRUE
		FROM users AS u
		WHERE sess.id=$1 AND sess.user_id=$2 AND sess.revoked=FALSE
		  AND u.id=sess.user_id AND u.id=$2
		RETURNING sess.device_type`, sessionID, userID).Scan(&deviceType)
	if errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, 404, "session not found")
		return
	}
	if err != nil {
		writeErr(w, 500, "revoke failed")
		return
	}

	s.kickRevokedSessions([]string{sessionID.String()}, "admin_revoked")
	s.audit(
		r.Context(), c.UserID, userEntID, "user.session_revoke",
		"session", sessionID.String(), reason, clientIP(r),
		map[string]any{"user_id": userID.String(), "device_type": deviceType},
	)
	writeJSON(w, 200, map[string]any{"ok": true, "id": sessionID.String()})
}

func countSessionsByStatus(rows []map[string]any, status string) int {
	n := 0
	for _, row := range rows {
		if row["status"] == status {
			n++
		}
	}
	return n
}
