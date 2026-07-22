package server

import (
	"context"
	"sync"
	"time"
)

var sessionTouchAt sync.Map // sessionID -> time.Time

const sessionTouchMinInterval = time.Minute

// touchSession updates sessions.last_active_at at most once per minute per session.
func (s *Server) touchSession(sessionID string) {
	if sessionID == "" {
		return
	}
	now := time.Now().UTC()
	if v, ok := sessionTouchAt.Load(sessionID); ok {
		if now.Sub(v.(time.Time)) < sessionTouchMinInterval {
			return
		}
	}
	sessionTouchAt.Store(sessionID, now)
	go func() {
		_, _ = s.db.Exec(context.Background(), `
			UPDATE sessions SET last_active_at=$2
			WHERE id=$1 AND revoked=FALSE`, sessionID, now)
	}()
}
