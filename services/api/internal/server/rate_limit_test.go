package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/qchat/qchat/services/api/internal/config"
)

func TestIPLimiterAllowsBurstThenBlocks(t *testing.T) {
	lim := newIPLimiter(1, 3) // 1/sec, burst 3
	ip := "203.0.113.10"
	for i := 0; i < 3; i++ {
		if !lim.allow(ip) {
			t.Fatalf("expected allow on request %d", i+1)
		}
	}
	if lim.allow(ip) {
		t.Fatal("expected block after burst exhausted")
	}
}

func TestLoginGuardLocksAfterFailures(t *testing.T) {
	g := newLoginGuard()
	phone, ip := "13800000999", "198.51.100.7"
	for i := 0; i < loginFailMax-1; i++ {
		g.fail(phone, ip)
		if g.locked(phone, ip) {
			t.Fatalf("locked early at fail %d", i+1)
		}
	}
	g.fail(phone, ip)
	if !g.locked(phone, ip) {
		t.Fatal("expected lockout after max failures")
	}
	g.clear(phone, ip)
	if g.locked(phone, ip) {
		t.Fatal("expected clear to remove lockout")
	}
}

func TestWithRateLimitBlocksAuthBurst(t *testing.T) {
	s := &Server{
		cfg:       config.Config{Env: "production"},
		limitAPI:  newIPLimiter(apiRatePerSec, apiBurst),
		limitAuth: newIPLimiter(authRatePerSec, authBurst),
		limitWS:   newIPLimiter(wsRatePerSec, wsBurst),
		mux:       http.NewServeMux(),
	}
	s.mux.HandleFunc("POST /v1/auth/login", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"ok": true})
	})
	h := s.withRateLimit(s.mux)

	var blocked bool
	for i := 0; i < int(authBurst)+3; i++ {
		req := httptest.NewRequest(http.MethodPost, "/v1/auth/login", nil)
		req.RemoteAddr = "203.0.113.50:12345"
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code == http.StatusTooManyRequests {
			blocked = true
			var body map[string]any
			_ = json.NewDecoder(rec.Body).Decode(&body)
			if body["code"] != "rate_limited" {
				t.Fatalf("unexpected body: %v", body)
			}
			if rec.Header().Get("Retry-After") == "" {
				t.Fatal("expected Retry-After header")
			}
			break
		}
		if rec.Code != 200 {
			t.Fatalf("unexpected status %d", rec.Code)
		}
	}
	if !blocked {
		t.Fatal("expected auth rate limit to trigger")
	}
}

func TestWithRateLimitDisabledInTestEnv(t *testing.T) {
	s := &Server{
		cfg:       config.Config{Env: "test"},
		limitAuth: newIPLimiter(0.0001, 1),
		mux:       http.NewServeMux(),
	}
	s.mux.HandleFunc("POST /v1/auth/login", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"ok": true})
	})
	h := s.withRateLimit(s.mux)
	for i := 0; i < 20; i++ {
		req := httptest.NewRequest(http.MethodPost, "/v1/auth/login", nil)
		req.RemoteAddr = "203.0.113.50:12345"
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != 200 {
			t.Fatalf("test env should not rate limit, got %d", rec.Code)
		}
	}
}

func TestWithRateLimitSkipsHealthz(t *testing.T) {
	s := &Server{
		cfg:      config.Config{Env: "production"},
		limitAPI: newIPLimiter(0.0001, 1),
		mux:      http.NewServeMux(),
	}
	s.mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"ok": true})
	})
	h := s.withRateLimit(s.mux)
	for i := 0; i < 5; i++ {
		req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
		req.RemoteAddr = "203.0.113.50:12345"
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != 200 {
			t.Fatalf("healthz should be unlimited, got %d", rec.Code)
		}
	}
}
