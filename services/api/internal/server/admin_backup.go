package server

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// handleAdminBackupStatus exposes backup/DR status written by deploy/backup.sh
// (requirements-en §3 recovery + §5 backup status monitoring).
func (s *Server) handleAdminBackupStatus(w http.ResponseWriter, r *http.Request) {
	if s.requireAdmin(w, r) == nil {
		return
	}
	if s.requirePerm(w, r, permAdminRead) == nil {
		return
	}

	dir := strings.TrimSpace(s.cfg.BackupDir)
	statusPath := filepath.Join(dir, "status.json")
	out := map[string]any{
		"backup_dir": dir,
		"rpo_hours":  24,
		"rto_hours":  4,
	}

	raw, err := os.ReadFile(statusPath)
	if err != nil {
		out["configured"] = false
		out["ok"] = false
		out["message"] = "no status.json — run deploy/backup.sh and ensure QCHAT_BACKUP_DIR points at the backups root"
		// Still list stamp dirs if present.
		out["recent"] = listBackupDirs(dir, 10)
		writeJSON(w, 200, out)
		return
	}

	var parsed map[string]any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		writeErr(w, 500, "status.json corrupt")
		return
	}
	out["configured"] = true
	out["status"] = parsed

	// Age of latest backup vs RPO.
	ok := true
	warnings := make([]string, 0)
	if latest, _ := parsed["latest"].(map[string]any); latest != nil {
		created := strings.TrimSpace(strAny(latest["created_at"]))
		if t, err := time.Parse("20060102T150405Z", created); err == nil {
			age := time.Since(t)
			out["latest_age_hours"] = age.Hours()
			if age > 24*time.Hour {
				ok = false
				warnings = append(warnings, "latest backup older than RPO 24h")
			}
		}
		if errN, okN := asFloat(latest["errors"]); okN && errN > 0 {
			ok = false
			warnings = append(warnings, "latest backup reported errors")
		}
		if enc, _ := latest["encrypted"].(bool); !enc {
			warnings = append(warnings, "latest backup not encrypted")
		}
	}
	if off, _ := parsed["offsite_configured"].(bool); !off {
		warnings = append(warnings, "QCHAT_BACKUP_OFFSITE not set — host loss may destroy backups")
	}
	if drill, _ := parsed["latest_drill"].(map[string]any); drill != nil {
		if dOK, _ := drill["ok"].(bool); !dOK {
			ok = false
			warnings = append(warnings, "latest restore drill did not pass")
		}
	} else {
		warnings = append(warnings, "no restore drill report yet — run deploy/restore_drill.sh")
	}

	out["ok"] = ok
	out["warnings"] = warnings
	writeJSON(w, 200, out)
}

func listBackupDirs(root string, limit int) []map[string]any {
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	out := make([]map[string]any, 0, limit)
	for i := len(entries) - 1; i >= 0 && len(out) < limit; i-- {
		e := entries[i]
		name := e.Name()
		if !e.IsDir() || name == "" || name[0] < '0' || name[0] > '9' {
			continue
		}
		out = append(out, map[string]any{
			"id":   name,
			"path": filepath.Join(root, name),
		})
	}
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
