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

// handleAdminPatchEnterprise updates enterprise policy fields (retention, support contact).
func (s *Server) handleAdminPatchEnterprise(w http.ResponseWriter, r *http.Request) {
	c := s.requirePerm(w, r, permEnterpriseWrite)
	if c == nil {
		return
	}
	entID := r.PathValue("id")
	if !isPlatformAdminRole(c.Role) && entID != c.EnterpriseID {
		writeErr(w, 403, "forbidden")
		return
	}
	var req struct {
		RetentionDays *int    `json:"retention_days"`
		SupportEmail  *string `json:"support_email"`
		SupportPhone  *string `json:"support_phone"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	if req.RetentionDays == nil && req.SupportEmail == nil && req.SupportPhone == nil {
		writeErr(w, 400, "no fields to update")
		return
	}

	auditMeta := map[string]any{}
	if req.RetentionDays != nil {
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
		auditMeta["retention_days"] = days
	}
	if req.SupportEmail != nil {
		email, err := normalizeEnterpriseSupportEmail(*req.SupportEmail)
		if err != nil {
			writeErrCode(w, 400, "invalid_support_email", err.Error())
			return
		}
		_, err = s.db.Exec(r.Context(), `UPDATE enterprises SET support_email=$2 WHERE id=$1`, entID, email)
		if err != nil {
			writeErr(w, 500, "update failed")
			return
		}
		auditMeta["support_email"] = email
	}
	if req.SupportPhone != nil {
		phone, err := normalizeEnterpriseSupportPhone(*req.SupportPhone)
		if err != nil {
			writeErrCode(w, 400, "invalid_support_phone", err.Error())
			return
		}
		_, err = s.db.Exec(r.Context(), `UPDATE enterprises SET support_phone=$2 WHERE id=$1`, entID, phone)
		if err != nil {
			writeErr(w, 500, "update failed")
			return
		}
		auditMeta["support_phone"] = phone
	}

	action := "enterprise.update"
	if _, ok := auditMeta["retention_days"]; ok && len(auditMeta) == 1 {
		action = "enterprise.retention"
	}
	s.audit(r.Context(), c.UserID, entID, action, "enterprise", entID, "", clientIP(r), auditMeta)

	out := map[string]any{"id": entID}
	if req.RetentionDays != nil {
		out["retention_days"] = *req.RetentionDays
	}
	if req.SupportEmail != nil {
		out["support_email"] = auditMeta["support_email"]
	}
	if req.SupportPhone != nil {
		out["support_phone"] = auditMeta["support_phone"]
	}
	writeJSON(w, 200, out)
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
