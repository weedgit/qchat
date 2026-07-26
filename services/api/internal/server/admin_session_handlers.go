package server

import (
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

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

	var exists bool
	if err := s.db.QueryRow(r.Context(), `
		SELECT EXISTS(
			SELECT 1 FROM users WHERE id=$1 AND enterprise_id=$2
		)`, userID, c.EnterpriseID).Scan(&exists); err != nil {
		writeErr(w, 500, "query failed")
		return
	}
	if !exists {
		writeErr(w, 404, "user not found")
		return
	}

	rows, err := s.db.Query(r.Context(), `
		SELECT id::text, device_type, COALESCE(device_name,''), COALESCE(device_id,''),
		       COALESCE(platform,''), COALESCE(ip,''), COALESCE(ip_region,''),
		       COALESCE(user_agent,''), created_at, expires_at,
		       COALESCE(last_active_at, created_at)
		FROM sessions
		WHERE user_id=$1 AND revoked=FALSE AND expires_at>now()
		ORDER BY COALESCE(last_active_at, created_at) DESC`, userID)
	if err != nil {
		writeErr(w, 500, "query failed")
		return
	}
	defer rows.Close()

	out := []map[string]any{}
	for rows.Next() {
		var id, deviceType, deviceName, deviceID, platform, ip, region, userAgent string
		var createdAt, expiresAt, lastActiveAt time.Time
		if rows.Scan(
			&id, &deviceType, &deviceName, &deviceID, &platform, &ip, &region,
			&userAgent, &createdAt, &expiresAt, &lastActiveAt,
		) != nil {
			continue
		}
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
		})
	}
	if err := rows.Err(); err != nil {
		writeErr(w, 500, "query failed")
		return
	}
	writeJSON(w, 200, map[string]any{"sessions": out})
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

	var deviceType string
	err = s.db.QueryRow(r.Context(), `
		UPDATE sessions AS sess
		SET revoked=TRUE
		FROM users AS u
		WHERE sess.id=$1 AND sess.user_id=$2 AND sess.revoked=FALSE
		  AND u.id=sess.user_id AND u.enterprise_id=$3
		RETURNING sess.device_type`, sessionID, userID, c.EnterpriseID).Scan(&deviceType)
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
		r.Context(), c.UserID, c.EnterpriseID, "user.session_revoke",
		"session", sessionID.String(), reason, clientIP(r),
		map[string]any{"user_id": userID.String(), "device_type": deviceType},
	)
	writeJSON(w, 200, map[string]any{"ok": true, "id": sessionID.String()})
}
