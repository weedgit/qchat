package server

import (
	"net/http"
	"strings"
	"sync"
	"time"
)

// In-process limits mirror deploy/nginx-qchat.conf zones so direct-to-API
// deployments still throttle. Per-process only unless Redis is attached for
// multi-instance fan-out (Phase 6).

const (
	apiRatePerSec   = 30.0
	apiBurst        = 60.0
	authRatePerSec  = 5.0 / 60.0 // 5 per minute
	authBurst       = 10.0
	wsRatePerSec    = 10.0 / 60.0
	wsBurst         = 20.0
	loginFailMax    = 5
	loginLockoutFor = 15 * time.Minute
)

type tokenBucket struct {
	tokens float64
	last   time.Time
}

type ipLimiter struct {
	mu     sync.Mutex
	rate   float64
	burst  float64
	byIP   map[string]*tokenBucket
	lastGC time.Time
}

func newIPLimiter(rate, burst float64) *ipLimiter {
	return &ipLimiter{
		rate:  rate,
		burst: burst,
		byIP:  make(map[string]*tokenBucket),
	}
}

func (l *ipLimiter) allow(ip string) bool {
	if ip == "" {
		ip = "unknown"
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	if now.Sub(l.lastGC) > 5*time.Minute {
		l.gcLocked(now)
		l.lastGC = now
	}
	b := l.byIP[ip]
	if b == nil {
		b = &tokenBucket{tokens: l.burst, last: now}
		l.byIP[ip] = b
	}
	elapsed := now.Sub(b.last).Seconds()
	b.last = now
	b.tokens += elapsed * l.rate
	if b.tokens > l.burst {
		b.tokens = l.burst
	}
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

func (l *ipLimiter) gcLocked(now time.Time) {
	for ip, b := range l.byIP {
		if now.Sub(b.last) > 10*time.Minute {
			delete(l.byIP, ip)
		}
	}
}

type loginFailState struct {
	count  int
	locked time.Time
}

type loginGuard struct {
	mu    sync.Mutex
	byKey map[string]*loginFailState
}

func newLoginGuard() *loginGuard {
	return &loginGuard{byKey: make(map[string]*loginFailState)}
}

func loginFailKey(phone, ip string) string {
	return strings.TrimSpace(phone) + "|" + strings.TrimSpace(ip)
}

func (g *loginGuard) locked(phone, ip string) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	st := g.byKey[loginFailKey(phone, ip)]
	if st == nil {
		return false
	}
	if !st.locked.IsZero() && time.Now().Before(st.locked) {
		return true
	}
	if !st.locked.IsZero() && !time.Now().Before(st.locked) {
		delete(g.byKey, loginFailKey(phone, ip))
	}
	return false
}

func (g *loginGuard) fail(phone, ip string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	key := loginFailKey(phone, ip)
	st := g.byKey[key]
	if st == nil {
		st = &loginFailState{}
		g.byKey[key] = st
	}
	if !st.locked.IsZero() && time.Now().Before(st.locked) {
		return
	}
	st.count++
	if st.count >= loginFailMax {
		st.locked = time.Now().Add(loginLockoutFor)
		st.count = 0
	}
}

func (g *loginGuard) clear(phone, ip string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	delete(g.byKey, loginFailKey(phone, ip))
}

func (s *Server) rateLimitEnabled() bool {
	return s.cfg.Env != "test"
}

func (s *Server) withRateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.rateLimitEnabled() {
			next.ServeHTTP(w, r)
			return
		}
		path := r.URL.Path
		if path == "/healthz" || path == "/metrics" {
			next.ServeHTTP(w, r)
			return
		}
		ip := clientIP(r)
		var lim *ipLimiter
		switch {
		case path == "/v1/ws":
			lim = s.limitWS
		case strings.HasPrefix(path, "/v1/auth/"):
			lim = s.limitAuth
		default:
			lim = s.limitAPI
		}
		if lim != nil && !lim.allow(ip) {
			w.Header().Set("Retry-After", "60")
			writeErrCode(w, http.StatusTooManyRequests, "rate_limited", "too many requests")
			return
		}
		next.ServeHTTP(w, r)
	})
}
