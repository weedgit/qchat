package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestPercentile(t *testing.T) {
	vals := []time.Duration{
		10 * time.Millisecond,
		20 * time.Millisecond,
		30 * time.Millisecond,
		40 * time.Millisecond,
		100 * time.Millisecond,
	}
	if got := percentile(vals, 50); got != 30*time.Millisecond {
		t.Fatalf("p50=%s want 30ms", got)
	}
	// idx = 95*(5-1)/100 = 3 → 40ms with the harness formula
	if got := percentile(vals, 95); got != 40*time.Millisecond {
		t.Fatalf("p95=%s want 40ms", got)
	}
	if got := percentile(vals, 100); got != 100*time.Millisecond {
		t.Fatalf("p100=%s want 100ms", got)
	}
}

func TestScrapeMetric(t *testing.T) {
	body := `# HELP qchat_ws_send_drops_total drops
# TYPE qchat_ws_send_drops_total counter
qchat_ws_send_drops_total 12
qchat_http_requests_total{method="GET",path="/v1",status="200"} 3
`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(body))
	}))
	defer srv.Close()

	got, err := scrapeMetric(srv.URL, "qchat_ws_send_drops_total")
	if err != nil {
		t.Fatal(err)
	}
	if got != 12 {
		t.Fatalf("got %v want 12", got)
	}
}
