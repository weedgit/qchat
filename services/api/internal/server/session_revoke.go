package server

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/qchat/qchat/services/api/internal/ws"
)

// In-memory set of recently revoked session IDs so access JWTs stop working
// immediately after same-type login / explicit revoke (before JWT exp).
// When Redis is attached, markers are also written there so peer API processes
// reject the same sessions.
var revokedSessionIDs sync.Map // sessionID -> time.Time

func markSessionsRevoked(ids []string) {
	now := time.Now().UTC()
	for _, id := range ids {
		if id == "" {
			continue
		}
		revokedSessionIDs.Store(id, now)
	}
}

func sessionAccessRevoked(sessionID string) bool {
	if sessionID == "" {
		return false
	}
	_, ok := revokedSessionIDs.Load(sessionID)
	return ok
}

func (s *Server) sessionAccessRevokedAny(sessionID string) bool {
	if sessionAccessRevoked(sessionID) {
		return true
	}
	if s.sessionRevokedInRedis(sessionID) {
		markSessionsRevoked([]string{sessionID})
		return true
	}
	return false
}

func (s *Server) markSessionsRevokedAll(ids []string) {
	markSessionsRevoked(ids)
	s.markSessionsRevokedRedis(ids)
}

// sessionRowActive checks Postgres for an unexpired, non-revoked session.
func (s *Server) sessionRowActive(ctx context.Context, sessionID string) bool {
	if sessionID == "" {
		return false
	}
	var revoked bool
	var expires time.Time
	err := s.db.QueryRow(ctx, `
		SELECT revoked, expires_at FROM sessions WHERE id=$1`, sessionID).Scan(&revoked, &expires)
	if err != nil {
		return false
	}
	if revoked || time.Now().After(expires) {
		s.markSessionsRevokedAll([]string{sessionID})
		return false
	}
	return true
}

// revokeSameTypeSessions enforces one active session per device_type (web|desktop|phone).
// Prior sessions of that type are revoked, notified over WS, and rejected on subsequent API calls.
func (s *Server) revokeSameTypeSessions(r *http.Request, userID, deviceType string) {
	dtype := normalizeDevice(deviceType)
	ctx := r.Context()
	rows, err := s.db.Query(ctx, `
		SELECT id::text FROM sessions
		WHERE user_id=$1 AND device_type=$2 AND revoked=FALSE`, userID, dtype)
	if err != nil {
		_, _ = s.db.Exec(ctx, `
			UPDATE sessions SET revoked=TRUE
			WHERE user_id=$1 AND device_type=$2 AND revoked=FALSE`, userID, dtype)
		return
	}
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil && id != "" {
			ids = append(ids, id)
		}
	}
	rows.Close()
	if len(ids) == 0 {
		return
	}
	_, _ = s.db.Exec(ctx, `
		UPDATE sessions SET revoked=TRUE
		WHERE user_id=$1 AND device_type=$2 AND revoked=FALSE`, userID, dtype)
	s.kickRevokedSessions(ids, "replaced")
}

func (s *Server) kickRevokedSessions(ids []string, reason string) {
	if len(ids) == 0 {
		return
	}
	s.markSessionsRevokedAll(ids)
	if s.hub == nil {
		return
	}
	s.hub.KickSessions(ids, ws.Event{
		Type: "session.revoked",
		Payload: map[string]any{
			"reason": reason,
		},
	})
}
