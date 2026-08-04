package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/qchat/qchat/services/api/internal/auth"
	"github.com/qchat/qchat/services/api/internal/backup"
)

func (s *Server) requirePlatformOwner(w http.ResponseWriter, r *http.Request) *auth.Claims {
	c := s.requireAdmin(w, r)
	if c == nil {
		return nil
	}
	if c.Role != rolePlatformAdmin {
		writeErrCode(w, 403, "forbidden", "platform owner required")
		return nil
	}
	return c
}

// handleAdminBackupStatus — platform owner only.
func (s *Server) handleAdminBackupStatus(w http.ResponseWriter, r *http.Request) {
	if s.requirePlatformOwner(w, r) == nil {
		return
	}
	writeJSON(w, 200, s.buildBackupStatusPayload())
}

func (s *Server) handleAdminBackupSettingsGet(w http.ResponseWriter, r *http.Request) {
	if s.requirePlatformOwner(w, r) == nil {
		return
	}
	settings, err := s.backups.LoadSettings()
	if err != nil {
		writeErr(w, 500, "could not load settings")
		return
	}
	writeJSON(w, 200, map[string]any{"settings": settings})
}

func (s *Server) handleAdminBackupSettingsPatch(w http.ResponseWriter, r *http.Request) {
	c := s.requirePlatformOwner(w, r)
	if c == nil {
		return
	}
	var req struct {
		AutoEnabled    *bool `json:"auto_enabled"`
		IntervalHours  *int  `json:"interval_hours"`
		IncludeSecrets *bool `json:"include_secrets"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	cur, err := s.backups.LoadSettings()
	if err != nil {
		writeErr(w, 500, "could not load settings")
		return
	}
	if req.AutoEnabled != nil {
		cur.AutoEnabled = *req.AutoEnabled
	}
	if req.IntervalHours != nil {
		h := *req.IntervalHours
		if h < backup.MinIntervalHrs || h > backup.MaxIntervalHrs {
			writeErr(w, 400, "interval_hours must be 1–168")
			return
		}
		cur.IntervalHours = h
	}
	if req.IncludeSecrets != nil {
		cur.IncludeSecrets = *req.IncludeSecrets
	}
	if err := s.backups.SaveSettings(cur, c.UserID); err != nil {
		writeErr(w, 500, "could not save settings")
		return
	}
	s.audit(r.Context(), c.UserID, c.EnterpriseID, "backup.settings", "backup", "", "", clientIP(r), map[string]any{
		"auto_enabled": cur.AutoEnabled, "interval_hours": cur.IntervalHours, "include_secrets": cur.IncludeSecrets,
	})
	writeJSON(w, 200, map[string]any{"settings": cur})
}

func (s *Server) handleAdminBackupRun(w http.ResponseWriter, r *http.Request) {
	c := s.requirePlatformOwner(w, r)
	if c == nil {
		return
	}
	var req struct {
		IncludeSecrets *bool `json:"include_secrets"`
	}
	if r.ContentLength > 0 {
		_ = decodeJSON(r, &req)
	}
	settings, _ := s.backups.LoadSettings()
	include := settings.IncludeSecrets
	if req.IncludeSecrets != nil {
		include = *req.IncludeSecrets
	}
	if err := s.backups.RunBackupAsync(include); err != nil {
		if errors.Is(err, backup.ErrBusy) {
			writeErrCode(w, 409, "busy", "backup or restore already running")
			return
		}
		writeErr(w, 500, err.Error())
		return
	}
	s.audit(r.Context(), c.UserID, c.EnterpriseID, "backup.run", "backup", "", "manual", clientIP(r), map[string]any{
		"include_secrets": include,
	})
	writeJSON(w, 202, map[string]any{"started": true, "job": s.backups.Job()})
}

func (s *Server) handleAdminBackupRestore(w http.ResponseWriter, r *http.Request) {
	c := s.requirePlatformOwner(w, r)
	if c == nil {
		return
	}
	var req struct {
		BackupID       string `json:"backup_id"`
		Mode           string `json:"mode"`
		Confirm        string `json:"confirm"`
		Reason         string `json:"reason"`
		IncludeSecrets *bool  `json:"include_secrets"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	reason, ok := adminReason(w, req.Reason)
	if !ok {
		return
	}
	settings, _ := s.backups.LoadSettings()
	include := settings.IncludeSecrets
	if req.IncludeSecrets != nil {
		include = *req.IncludeSecrets
	}
	mode := strings.ToLower(strings.TrimSpace(req.Mode))
	if mode == "" {
		mode = "drill"
	}
	if err := s.backups.RunRestoreAsync(req.BackupID, mode, req.Confirm, include); err != nil {
		switch {
		case errors.Is(err, backup.ErrBusy):
			writeErrCode(w, 409, "busy", "backup or restore already running")
		case errors.Is(err, backup.ErrInvalidBackupID):
			writeErrCode(w, 400, "invalid_backup_id", err.Error())
		case errors.Is(err, backup.ErrBackupNotFound):
			writeErrCode(w, 404, "not_found", err.Error())
		case errors.Is(err, backup.ErrConfirmRequired):
			writeErrCode(w, 400, "confirm_required", "production restore requires confirm=RESTORE")
		default:
			writeErr(w, 400, err.Error())
		}
		return
	}
	s.audit(r.Context(), c.UserID, c.EnterpriseID, "backup.restore", "backup", req.BackupID, reason, clientIP(r), map[string]any{
		"mode": mode, "include_secrets": include,
	})
	writeJSON(w, 202, map[string]any{"started": true, "job": s.backups.Job()})
}

func (s *Server) buildBackupStatusPayload() map[string]any {
	dir := strings.TrimSpace(s.cfg.BackupDir)
	out := map[string]any{
		"backup_dir": dir,
		"repo_root":  s.cfg.RepoRoot,
		"rpo_hours":  24,
		"rto_hours":  4,
		"job":        s.backups.Job(),
	}
	settings, err := s.backups.LoadSettings()
	if err == nil {
		out["settings"] = settings
	}
	out["recent"] = s.backups.ListBackups(20)

	statusPath := filepath.Join(dir, "status.json")
	raw, err := os.ReadFile(statusPath)
	if err != nil {
		out["configured"] = false
		out["ok"] = false
		out["message"] = "no status.json yet — run a backup from this page or deploy/backup.sh"
		return out
	}
	var parsed map[string]any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		out["configured"] = false
		out["ok"] = false
		out["message"] = "status.json corrupt"
		return out
	}
	out["configured"] = true
	out["status"] = parsed

	ok := true
	warnings := make([]string, 0)
	if latest, _ := parsed["latest"].(map[string]any); latest != nil {
		created := strings.TrimSpace(strAny(latest["created_at"]))
		if t, err := time.Parse("20060102T150405Z", created); err == nil {
			age := time.Since(t)
			out["latest_age_hours"] = age.Hours()
			interval := settings.IntervalHours
			if interval < 1 {
				interval = backup.DefaultIntervalHrs
			}
			if age > time.Duration(interval)*time.Hour {
				ok = false
				warnings = append(warnings, "latest backup older than configured interval")
			}
		}
		if errN, okN := asFloat(latest["errors"]); okN && errN > 0 {
			ok = false
			warnings = append(warnings, "latest backup reported errors")
		}
	}
	if off, _ := parsed["offsite_configured"].(bool); !off {
		warnings = append(warnings, "QCHAT_BACKUP_OFFSITE not set — host loss may destroy backups")
	}
	out["ok"] = ok
	out["warnings"] = warnings
	return out
}

func strAny(v any) string {
	switch t := v.(type) {
	case string:
		return t
	default:
		return ""
	}
}

func asFloat(v any) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case int:
		return float64(t), true
	case int64:
		return float64(t), true
	case json.Number:
		f, err := t.Float64()
		return f, err == nil
	default:
		return 0, false
	}
}

// StartBackupScheduler checks settings and runs automatic backups.
func (s *Server) StartBackupScheduler(ctx context.Context) {
	go func() {
		t := time.NewTicker(5 * time.Minute)
		defer t.Stop()
		select {
		case <-ctx.Done():
			return
		case <-time.After(45 * time.Second):
			s.backups.MaybeAutoBackup(ctx)
		}
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				s.backups.MaybeAutoBackup(ctx)
			}
		}
	}()
}
