package server

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

const revokedSessionKeyPrefix = "qchat:revoked:"

// revokedSessionTTL keeps remote revoke markers at least as long as access tokens.
const revokedSessionTTL = 24 * time.Hour

func (s *Server) attachRevokeRedis(rdb *redis.Client) {
	s.revokeRDB = rdb
}

func (s *Server) markSessionsRevokedRedis(ids []string) {
	if s.revokeRDB == nil || len(ids) == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	pipe := s.revokeRDB.Pipeline()
	for _, id := range ids {
		if id == "" {
			continue
		}
		pipe.Set(ctx, revokedSessionKeyPrefix+id, "1", revokedSessionTTL)
	}
	_, _ = pipe.Exec(ctx)
}

func (s *Server) sessionRevokedInRedis(sessionID string) bool {
	if s.revokeRDB == nil || sessionID == "" {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	n, err := s.revokeRDB.Exists(ctx, revokedSessionKeyPrefix+sessionID).Result()
	return err == nil && n > 0
}
