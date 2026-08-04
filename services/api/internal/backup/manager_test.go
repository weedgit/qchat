package backup

import (
	"testing"
	"time"
)

func TestValidBackupID(t *testing.T) {
	if !validBackupID("20260803T095017Z") {
		t.Fatal("expected valid")
	}
	if validBackupID("../etc") {
		t.Fatal("path traversal should be invalid")
	}
	if validBackupID("20260803T095017") {
		t.Fatal("missing Z")
	}
}

func TestNormalizeSettings(t *testing.T) {
	s := normalizeSettings(Settings{IntervalHours: 0})
	if s.IntervalHours != DefaultIntervalHrs {
		t.Fatalf("got %d", s.IntervalHours)
	}
	s = normalizeSettings(Settings{IntervalHours: 999})
	if s.IntervalHours != MaxIntervalHrs {
		t.Fatalf("got %d", s.IntervalHours)
	}
}

func TestDefaultSettings(t *testing.T) {
	s := DefaultSettings()
	if !s.AutoEnabled || s.IntervalHours != 24 {
		t.Fatalf("%+v", s)
	}
}

func TestTruncate(t *testing.T) {
	if len(truncate("abc", 10)) != 3 {
		t.Fatal()
	}
	if len(truncate("0123456789", 5)) < 5 {
		t.Fatal()
	}
}

func TestLatestBackupAgeMissing(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(dir, dir)
	_, ok := m.latestBackupAge()
	if ok {
		t.Fatal("expected false")
	}
}

func TestSaveLoadSettings(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(dir, dir)
	want := Settings{AutoEnabled: false, IntervalHours: 12, IncludeSecrets: true}
	if err := m.SaveSettings(want, "user-1"); err != nil {
		t.Fatal(err)
	}
	got, err := m.LoadSettings()
	if err != nil {
		t.Fatal(err)
	}
	if got.AutoEnabled != want.AutoEnabled || got.IntervalHours != 12 || !got.IncludeSecrets {
		t.Fatalf("%+v", got)
	}
	if got.UpdatedBy != "user-1" {
		t.Fatalf("updated_by=%q", got.UpdatedBy)
	}
	_ = time.Now()
}
