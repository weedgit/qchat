package server

import (
	"context"
	"log"
	"net/http"
	"time"
)

const userLogRetentionDefaultDays = 90

var userLogRetentionOptions = []int{90, 180, 365}

// userLogSQLFilter excludes message and login audit actions from the user log view.
const userLogSQLFilter = `
  AND a.action NOT LIKE 'message.%'
  AND a.action NOT LIKE 'messages.%'
  AND a.action NOT ILIKE '%login%'`

func validUserLogRetentionDays(days int) bool {
	for _, d := range userLogRetentionOptions {
		if days == d {
			return true
		}
	}
	return false
}

func (s *Server) platformUserLogRetentionDays(ctx context.Context) (int, error) {
	var days int
	err := s.db.QueryRow(ctx, `
		SELECT user_log_retention_days FROM platform_settings WHERE singleton IS TRUE`).
		Scan(&days)
	if err != nil {
		return userLogRetentionDefaultDays, err
	}
	return days, nil
}

func (s *Server) enterpriseUserLogRetentionDays(ctx context.Context, entID string) (int, error) {
	var days int
	err := s.db.QueryRow(ctx, `
		SELECT user_log_retention_days FROM enterprises WHERE id=$1`, entID).Scan(&days)
	if err != nil {
		return userLogRetentionDefaultDays, err
	}
	return days, nil
}

func (s *Server) handleAdminUserLogSettingsGet(w http.ResponseWriter, r *http.Request) {
	c := s.requirePerm(w, r, permAdminRead)
	if c == nil {
		return
	}
	if isPlatformAdminRole(c.Role) {
		days, err := s.platformUserLogRetentionDays(r.Context())
		if err != nil {
			writeErr(w, 500, "query failed")
			return
		}
		writeJSON(w, 200, map[string]any{
			"retention_days": days,
			"options":        userLogRetentionOptions,
			"scope":          "platform",
		})
		return
	}
	days, err := s.enterpriseUserLogRetentionDays(r.Context(), c.EnterpriseID)
	if err != nil {
		writeErr(w, 500, "query failed")
		return
	}
	writeJSON(w, 200, map[string]any{
		"retention_days": days,
		"options":        userLogRetentionOptions,
		"scope":          "enterprise",
		"enterprise_id":  c.EnterpriseID,
	})
}

func (s *Server) handleAdminUserLogSettingsPatch(w http.ResponseWriter, r *http.Request) {
	c := s.requirePerm(w, r, permEnterpriseWrite)
	if c == nil {
		return
	}
	var req struct {
		RetentionDays int `json:"retention_days"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	if !validUserLogRetentionDays(req.RetentionDays) {
		writeErr(w, 400, "retention_days must be 90, 180, or 365")
		return
	}
	if isPlatformAdminRole(c.Role) {
		_, err := s.db.Exec(r.Context(), `
			UPDATE platform_settings SET user_log_retention_days=$1 WHERE singleton IS TRUE`,
			req.RetentionDays)
		if err != nil {
			writeErr(w, 500, "update failed")
			return
		}
		_, _ = s.db.Exec(r.Context(), `
			UPDATE enterprises SET user_log_retention_days=$1`, req.RetentionDays)
		s.audit(r.Context(), c.UserID, c.EnterpriseID, "user_log.retention", "platform", "", "", clientIP(r), map[string]any{
			"retention_days": req.RetentionDays,
		})
		writeJSON(w, 200, map[string]any{
			"retention_days": req.RetentionDays,
			"options":        userLogRetentionOptions,
			"scope":          "platform",
		})
		return
	}
	_, err := s.db.Exec(r.Context(), `
		UPDATE enterprises SET user_log_retention_days=$2 WHERE id=$1`,
		c.EnterpriseID, req.RetentionDays)
	if err != nil {
		writeErr(w, 500, "update failed")
		return
	}
	s.audit(r.Context(), c.UserID, c.EnterpriseID, "user_log.retention", "enterprise", c.EnterpriseID, "", clientIP(r), map[string]any{
		"retention_days": req.RetentionDays,
	})
	writeJSON(w, 200, map[string]any{
		"retention_days": req.RetentionDays,
		"options":        userLogRetentionOptions,
		"scope":          "enterprise",
		"enterprise_id":  c.EnterpriseID,
	})
}

// RunUserLogRetention deletes audit rows older than each scope's retention policy.
func (s *Server) RunUserLogRetention(ctx context.Context) (int64, error) {
	tagEnt, err := s.db.Exec(ctx, `
		DELETE FROM audit_logs a
		USING enterprises e
		WHERE a.enterprise_id = e.id
		  AND a.created_at < now() - make_interval(days => e.user_log_retention_days)`)
	if err != nil {
		return 0, err
	}
	platformDays, err := s.platformUserLogRetentionDays(ctx)
	if err != nil {
		return tagEnt.RowsAffected(), nil
	}
	tagNull, err := s.db.Exec(ctx, `
		DELETE FROM audit_logs
		WHERE enterprise_id IS NULL
		  AND created_at < now() - make_interval(days => $1)`, platformDays)
	if err != nil {
		return tagEnt.RowsAffected(), err
	}
	return tagEnt.RowsAffected() + tagNull.RowsAffected(), nil
}

// StartUserLogRetentionLoop purges expired user-log rows on an interval.
func (s *Server) StartUserLogRetentionLoop(ctx context.Context, every time.Duration) {
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
			if n, err := s.RunUserLogRetention(ctx); err != nil {
				log.Printf("user_log retention: %v", err)
			} else if n > 0 {
				log.Printf("user_log retention: deleted %d rows", n)
			}
		}
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				n, err := s.RunUserLogRetention(ctx)
				if err != nil {
					log.Printf("user_log retention: %v", err)
					continue
				}
				if n > 0 {
					log.Printf("user_log retention: deleted %d rows", n)
				}
			}
		}
	}()
}
