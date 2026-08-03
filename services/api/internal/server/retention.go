package server

import (
	"context"
	"log"
	"net/http"
	"time"
)

// RunRetention deletes messages older than each enterprise's retention_days
// (DataRetentionJob / RunDataRetention).
func (s *Server) RunRetention(ctx context.Context) (int64, error) {
	entTag, err := s.db.Exec(ctx, `
		DELETE FROM messages m
		USING enterprises e
		WHERE m.enterprise_id = e.id
		  AND m.created_at < now() - make_interval(days => e.retention_days)`)
	if err != nil {
		return 0, err
	}
	return entTag.RowsAffected(), nil
}

// StartRetentionLoop runs RunRetention on an interval (default 24h).
func (s *Server) StartRetentionLoop(ctx context.Context, every time.Duration) {
	if every <= 0 {
		every = 24 * time.Hour
	}
	go func() {
		t := time.NewTicker(every)
		defer t.Stop()
		select {
		case <-ctx.Done():
			return
		case <-time.After(30 * time.Second):
			if n, err := s.RunRetention(ctx); err != nil {
				log.Printf("retention: %v", err)
			} else if n > 0 {
				log.Printf("retention: deleted %d messages", n)
			}
		}
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				n, err := s.RunRetention(ctx)
				if err != nil {
					log.Printf("retention: %v", err)
					continue
				}
				if n > 0 {
					log.Printf("retention: deleted %d messages", n)
				}
			}
		}
	}()
}

// handleAdminPatchEnterprise updates retention_days (DataRetention policy knob).
func (s *Server) handleAdminPatchEnterprise(w http.ResponseWriter, r *http.Request) {
	c := s.requirePerm(w, r, permEnterpriseWrite)
	if c == nil {
		return
	}
	entID := r.PathValue("id")
	if c.Role != "platform_owner" && entID != c.EnterpriseID {
		writeErr(w, 403, "forbidden")
		return
	}
	var req struct {
		RetentionDays *int `json:"retention_days"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	if req.RetentionDays == nil {
		writeErr(w, 400, "retention_days required")
		return
	}
	days := *req.RetentionDays
	if days < 1 || days > 3650 {
		writeErr(w, 400, "retention_days must be 1–3650")
		return
	}
	_, err := s.db.Exec(r.Context(), `UPDATE enterprises SET retention_days=$2 WHERE id=$1`, entID, days)
	if err != nil {
		writeErr(w, 500, "update failed")
		return
	}
	s.audit(r.Context(), c.UserID, entID, "enterprise.retention", "enterprise", entID, "", clientIP(r), map[string]any{"retention_days": days})
	writeJSON(w, 200, map[string]any{"id": entID, "retention_days": days})
}

func (s *Server) handleAdminRunRetention(w http.ResponseWriter, r *http.Request) {
	c := s.requirePerm(w, r, permRetention)
	if c == nil {
		return
	}
	deleted, err := s.RunRetention(r.Context())
	if err != nil {
		writeErr(w, 500, "retention failed")
		return
	}
	s.audit(r.Context(), c.UserID, c.EnterpriseID, "retention.run", "enterprise", c.EnterpriseID, "", clientIP(r), map[string]any{"deleted": deleted})
	writeJSON(w, 200, map[string]any{"deleted": deleted})
}
