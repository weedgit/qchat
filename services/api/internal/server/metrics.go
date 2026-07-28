package server

import (
	"bufio"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var (
	httpRequests = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "qchat_http_requests_total",
		Help: "Total HTTP requests by method, path group, and status",
	}, []string{"method", "path", "status"})

	httpDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "qchat_http_request_duration_seconds",
		Help:    "HTTP request latency",
		Buckets: prometheus.DefBuckets,
	}, []string{"method", "path"})

	httpErrors = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "qchat_http_errors_total",
		Help: "HTTP responses with status >= 400",
	}, []string{"method", "path", "status"})

	wsConnections = promauto.NewGaugeFunc(prometheus.GaugeOpts{
		Name: "qchat_ws_connections",
		Help: "Current WebSocket connections (websocket metrics)",
	}, func() float64 {
		if wsGaugeFn == nil {
			return 0
		}
		return wsGaugeFn()
	})

	messagePublishDuration = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "qchat_message_publish_duration_seconds",
		Help:    "Time to fan out message.new on the local WS hub (before HTTP response)",
		Buckets: []float64{0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2},
	})
)

var wsGaugeFn func() float64

func (s *Server) registerWSGauge() {
	wsGaugeFn = func() float64 {
		return float64(s.hub.TotalConnections())
	}
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

// Hijack lets WebSocket upgrades work when metrics wrap the writer.
func (r *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := r.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("response does not implement http.Hijacker")
	}
	return h.Hijack()
}

func (r *statusRecorder) Flush() {
	if f, ok := r.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func metricsPath(p string) string {
	switch {
	case p == "/healthz" || p == "/metrics":
		return p
	case strings.HasPrefix(p, "/v1/ws"):
		return "/v1/ws"
	case strings.HasPrefix(p, "/v1/auth/"):
		return "/v1/auth"
	case strings.HasPrefix(p, "/v1/admin/"):
		return "/v1/admin"
	case strings.HasPrefix(p, "/v1/media/"):
		return "/v1/media"
	case strings.HasPrefix(p, "/v1/calls"):
		return "/v1/calls"
	case strings.HasPrefix(p, "/v1/"):
		return "/v1"
	default:
		return "other"
	}
}

func (s *Server) withMetrics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Never wrap /v1/ws: gorilla Upgrade needs the raw Hijacker.
		if r.URL.Path == "/metrics" || r.URL.Path == "/v1/ws" {
			next.ServeHTTP(w, r)
			return
		}
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: 200}
		next.ServeHTTP(rec, r)
		path := metricsPath(r.URL.Path)
		status := strconv.Itoa(rec.status)
		httpRequests.WithLabelValues(r.Method, path, status).Inc()
		httpDuration.WithLabelValues(r.Method, path).Observe(time.Since(start).Seconds())
		if rec.status >= 400 {
			httpErrors.WithLabelValues(r.Method, path, status).Inc()
		}
	})
}

func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	promhttp.Handler().ServeHTTP(w, r)
}
