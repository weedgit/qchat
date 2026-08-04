package backup

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	SettingsSchema     = 1
	DefaultIntervalHrs = 24
	MinIntervalHrs     = 1
	MaxIntervalHrs     = 168
	ConfirmRestore     = "RESTORE"
)

var (
	ErrBusy            = errors.New("backup job already running")
	ErrInvalidBackupID = errors.New("invalid backup id")
	ErrBackupNotFound  = errors.New("backup not found")
	ErrConfirmRequired = errors.New("confirm must be RESTORE for production restore")
)

// Settings controls automatic backups (persisted in backup_dir/settings.json).
type Settings struct {
	Schema         int    `json:"schema"`
	AutoEnabled    bool   `json:"auto_enabled"`
	IntervalHours  int    `json:"interval_hours"`
	IncludeSecrets bool   `json:"include_secrets"`
	UpdatedAt      string `json:"updated_at,omitempty"`
	UpdatedBy      string `json:"updated_by,omitempty"`
}

// JobState tracks an in-flight or last backup/restore operation.
type JobState struct {
	Running    bool       `json:"running"`
	Kind       string     `json:"kind"`
	BackupID   string     `json:"backup_id,omitempty"`
	Mode       string     `json:"mode,omitempty"`
	StartedAt  time.Time  `json:"started_at"`
	FinishedAt *time.Time `json:"finished_at,omitempty"`
	OK         bool       `json:"ok"`
	Message    string     `json:"message,omitempty"`
	Output     string     `json:"output,omitempty"`
}

// Manager runs deploy backup/restore scripts for the admin console.
type Manager struct {
	repoRoot  string
	backupDir string
	mu        sync.Mutex
	job       *JobState
}

func NewManager(repoRoot, backupDir string) *Manager {
	return &Manager{
		repoRoot:  strings.TrimSpace(repoRoot),
		backupDir: strings.TrimSpace(backupDir),
	}
}

func (m *Manager) SettingsPath() string {
	return filepath.Join(m.backupDir, "settings.json")
}

func (m *Manager) StatusPath() string {
	return filepath.Join(m.backupDir, "status.json")
}

// LoadSettings returns persisted settings or defaults.
func (m *Manager) LoadSettings() (Settings, error) {
	def := DefaultSettings()
	raw, err := os.ReadFile(m.SettingsPath())
	if err != nil {
		if os.IsNotExist(err) {
			return def, nil
		}
		return def, err
	}
	var s Settings
	if err := json.Unmarshal(raw, &s); err != nil {
		return def, err
	}
	s = normalizeSettings(s)
	return s, nil
}

func DefaultSettings() Settings {
	return Settings{
		Schema:        SettingsSchema,
		AutoEnabled:   true,
		IntervalHours: DefaultIntervalHrs,
	}
}

func normalizeSettings(s Settings) Settings {
	if s.Schema == 0 {
		s.Schema = SettingsSchema
	}
	if s.IntervalHours < MinIntervalHrs {
		s.IntervalHours = DefaultIntervalHrs
	}
	if s.IntervalHours > MaxIntervalHrs {
		s.IntervalHours = MaxIntervalHrs
	}
	return s
}

// SaveSettings persists operator settings.
func (m *Manager) SaveSettings(s Settings, updatedBy string) error {
	s = normalizeSettings(s)
	s.Schema = SettingsSchema
	s.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	s.UpdatedBy = strings.TrimSpace(updatedBy)
	if err := os.MkdirAll(m.backupDir, 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	return os.WriteFile(m.SettingsPath(), raw, 0o644)
}

// Job returns a copy of current job state.
func (m *Manager) Job() *JobState {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.job == nil {
		return nil
	}
	cp := *m.job
	return &cp
}

func (m *Manager) setJob(j *JobState) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.job = j
}

func (m *Manager) beginJob(kind, backupID, mode string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.job != nil && m.job.Running {
		return ErrBusy
	}
	m.job = &JobState{
		Running:   true,
		Kind:      kind,
		BackupID:  backupID,
		Mode:      mode,
		StartedAt: time.Now().UTC(),
	}
	return nil
}

func (m *Manager) finishJob(ok bool, msg, output string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.job == nil {
		return
	}
	now := time.Now().UTC()
	m.job.Running = false
	m.job.OK = ok
	m.job.Message = msg
	m.job.Output = truncate(output, 8000)
	m.job.FinishedAt = &now
}

// RunBackup executes deploy/backup.sh (blocking).
func (m *Manager) RunBackup(ctx context.Context, includeSecrets bool) (string, error) {
	if err := m.beginJob("backup", "", ""); err != nil {
		return "", err
	}
	return m.doBackup(ctx, includeSecrets)
}

func (m *Manager) doBackup(ctx context.Context, includeSecrets bool) (string, error) {
	out, err := m.execScript(ctx, "backup.sh", includeSecrets, nil)
	if err != nil {
		m.finishJob(false, err.Error(), out)
		return out, err
	}
	m.finishJob(true, "backup complete", out)
	return out, nil
}

// RunBackupAsync starts backup in a goroutine.
func (m *Manager) RunBackupAsync(includeSecrets bool) error {
	if err := m.beginJob("backup", "", ""); err != nil {
		return err
	}
	go func() {
		_, _ = m.doBackup(context.Background(), includeSecrets)
	}()
	return nil
}

// RunRestore restores from a stamped backup directory.
// mode: "production" or "drill".
func (m *Manager) RunRestore(ctx context.Context, backupID, mode, confirm string, includeSecrets bool) (string, error) {
	backupID = strings.TrimSpace(backupID)
	if !validBackupID(backupID) {
		return "", ErrInvalidBackupID
	}
	src := filepath.Join(m.backupDir, backupID)
	if st, err := os.Stat(src); err != nil || !st.IsDir() {
		return "", ErrBackupNotFound
	}
	mode = strings.ToLower(strings.TrimSpace(mode))
	if mode != "production" && mode != "drill" {
		return "", fmt.Errorf("mode must be production or drill")
	}
	if mode == "production" && strings.TrimSpace(confirm) != ConfirmRestore {
		return "", ErrConfirmRequired
	}

	if err := m.beginJob("restore", backupID, mode); err != nil {
		return "", err
	}
	return m.doRestore(ctx, backupID, mode, confirm, includeSecrets)
}

func (m *Manager) doRestore(ctx context.Context, backupID, mode, confirm string, includeSecrets bool) (string, error) {
	backupID = strings.TrimSpace(backupID)
	src := filepath.Join(m.backupDir, backupID)

	extra := map[string]string{}
	if mode == "production" {
		extra["QCHAT_RESTORE_CONFIRM"] = "YES"
		if includeSecrets {
			extra["QCHAT_RESTORE_SECRETS"] = "1"
		}
	} else {
		extra["QCHAT_RESTORE_DB"] = "qchat_drill"
	}

	out, err := m.execScript(ctx, "restore.sh", false, extra, src)
	if err != nil {
		m.finishJob(false, err.Error(), out)
		return out, err
	}

	if mode == "drill" {
		dropOut, dropErr := m.execCompose(ctx, "exec", "-T", "postgres",
			"psql", "-U", "qchat", "-d", "postgres", "-v", "ON_ERROR_STOP=1",
			"-c", "DROP DATABASE IF EXISTS qchat_drill;")
		out += "\n" + dropOut
		if dropErr != nil {
			m.finishJob(false, "drill restore ok but drop failed: "+dropErr.Error(), out)
			return out, dropErr
		}
	}

	m.finishJob(true, "restore complete", out)
	return out, nil
}

// RunRestoreAsync starts restore in background.
func (m *Manager) RunRestoreAsync(backupID, mode, confirm string, includeSecrets bool) error {
	backupID = strings.TrimSpace(backupID)
	if !validBackupID(backupID) {
		return ErrInvalidBackupID
	}
	src := filepath.Join(m.backupDir, backupID)
	if st, err := os.Stat(src); err != nil || !st.IsDir() {
		return ErrBackupNotFound
	}
	mode = strings.ToLower(strings.TrimSpace(mode))
	if mode != "production" && mode != "drill" {
		return fmt.Errorf("mode must be production or drill")
	}
	if mode == "production" && strings.TrimSpace(confirm) != ConfirmRestore {
		return ErrConfirmRequired
	}
	if err := m.beginJob("restore", backupID, mode); err != nil {
		return err
	}
	go func() {
		_, _ = m.doRestore(context.Background(), backupID, mode, confirm, includeSecrets)
	}()
	return nil
}

// MaybeAutoBackup runs backup when auto settings say it is due.
func (m *Manager) MaybeAutoBackup(ctx context.Context) {
	if m.Job() != nil && m.Job().Running {
		return
	}
	settings, err := m.LoadSettings()
	if err != nil || !settings.AutoEnabled {
		return
	}
	age, ok := m.latestBackupAge()
	if ok && age < time.Duration(settings.IntervalHours)*time.Hour {
		return
	}
	_ = m.RunBackupAsync(settings.IncludeSecrets)
}

func (m *Manager) latestBackupAge() (time.Duration, bool) {
	raw, err := os.ReadFile(m.StatusPath())
	if err != nil {
		return 0, false
	}
	var parsed struct {
		Latest struct {
			CreatedAt string `json:"created_at"`
		} `json:"latest"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return 0, false
	}
	t, err := time.Parse("20060102T150405Z", strings.TrimSpace(parsed.Latest.CreatedAt))
	if err != nil {
		return 0, false
	}
	return time.Since(t), true
}

func (m *Manager) execScript(ctx context.Context, script string, includeSecrets bool, extraEnv map[string]string, args ...string) (string, error) {
	scriptPath := filepath.Join(m.repoRoot, "deploy", script)
	if _, err := os.Stat(scriptPath); err != nil {
		return "", fmt.Errorf("script missing: %s", scriptPath)
	}
	cmd := exec.CommandContext(ctx, "bash", append([]string{scriptPath}, args...)...)
	cmd.Dir = m.repoRoot
	cmd.Env = os.Environ()
	cmd.Env = append(cmd.Env, "QCHAT_BACKUP_DIR="+m.backupDir)
	if includeSecrets {
		cmd.Env = append(cmd.Env, "QCHAT_BACKUP_INCLUDE_SECRETS=1")
	}
	for k, v := range extraEnv {
		cmd.Env = append(cmd.Env, k+"="+v)
	}
	var buf bytes.Buffer
	cmd.Stdout = &buf
	cmd.Stderr = &buf
	err := cmd.Run()
	return buf.String(), err
}

func (m *Manager) execCompose(ctx context.Context, args ...string) (string, error) {
	composeFile := filepath.Join(m.repoRoot, "docker-compose.yml")
	cmd := exec.CommandContext(ctx, "docker", append([]string{"compose", "-f", composeFile}, args...)...)
	cmd.Dir = m.repoRoot
	cmd.Env = os.Environ()
	if os.Getenv("LIVEKIT_NODE_IP") == "" {
		cmd.Env = append(cmd.Env, "LIVEKIT_NODE_IP=127.0.0.1")
	}
	var buf bytes.Buffer
	cmd.Stdout = &buf
	cmd.Stderr = &buf
	err := cmd.Run()
	return buf.String(), err
}

func validBackupID(id string) bool {
	// 20260803T095017Z (16 chars)
	if len(id) != 16 || id[8] != 'T' || id[15] != 'Z' {
		return false
	}
	for i, c := range id {
		if i == 8 || i == 15 {
			continue
		}
		if c < '0' || c > '9' {
			return false
		}
	}
	return !strings.Contains(id, "..") && !strings.Contains(id, "/")
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "\n…(truncated)"
}

// ListBackups returns recent backup stamp directories.
func (m *Manager) ListBackups(limit int) []map[string]any {
	if limit <= 0 {
		limit = 20
	}
	entries, err := os.ReadDir(m.backupDir)
	if err != nil {
		return nil
	}
	out := make([]map[string]any, 0, limit)
	for i := len(entries) - 1; i >= 0 && len(out) < limit; i-- {
		name := entries[i].Name()
		if !entries[i].IsDir() || !validBackupID(name) {
			continue
		}
		item := map[string]any{"id": name, "path": filepath.Join(m.backupDir, name)}
		mpath := filepath.Join(m.backupDir, name, "manifest.json")
		if raw, err := os.ReadFile(mpath); err == nil {
			var man map[string]any
			if json.Unmarshal(raw, &man) == nil {
				item["manifest"] = man
			}
		}
		out = append(out, item)
	}
	return out
}
