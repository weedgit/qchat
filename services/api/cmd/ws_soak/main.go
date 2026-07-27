// Command ws_soak opens many WebSocket sessions against the API to validate
// ≥1000 concurrent online connections, reconnect churn, and message fan-out
// latency (contract: delivery under one second).
//
// Usage:
//
//	go run ./cmd/ws_soak -n 1000 -base http://localhost:8080 \
//	  -phone 13800000002 -password user12345
//
// Latency mode (default on) creates a throwaway group, sends probe messages,
// and measures time until message.new arrives on all local sockets:
//
//	go run ./cmd/ws_soak -n 1000 -latency-rounds 20 -latency-max 1s
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

func main() {
	n := flag.Int("n", 1000, "concurrent WebSocket connections")
	base := flag.String("base", "http://localhost:8080", "API base URL")
	token := flag.String("token", "", "access token (optional if phone/password set)")
	phone := flag.String("phone", "13800000002", "login phone")
	password := flag.String("password", "user12345", "login password")
	invite := flag.String("invite", "ACME2026", "invite code for login (unused when registering not required)")
	hold := flag.Duration("hold", 5*time.Second, "how long to hold connections open after latency probes")
	reconnects := flag.Int("reconnects", 1, "disconnect/reconnect cycles after initial hold")
	latencyRounds := flag.Int("latency-rounds", 20, "message fan-out probes (0 to skip)")
	latencyMax := flag.Duration("latency-max", time.Second, "fail if p95 first-delivery latency exceeds this")
	fanoutMax := flag.Duration("fanout-max", 2*time.Second, "fail if p95 full-fanout latency exceeds this")
	flag.Parse()

	tok := *token
	if tok == "" {
		var err error
		tok, err = login(*base, *phone, *password, *invite)
		if err != nil {
			log.Fatalf("login: %v", err)
		}
		log.Printf("logged in as %s", *phone)
	}

	wsURL := toWS(*base) + "/v1/ws?token=" + url.QueryEscape(tok)
	log.Printf("opening %d connections to %s", *n, strings.Split(wsURL, "?")[0])

	var ok, fail atomic.Int64
	conns := make([]*websocket.Conn, *n)
	var mu sync.Mutex

	var wg sync.WaitGroup
	sem := make(chan struct{}, 64)
	for i := 0; i < *n; i++ {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int) {
			defer wg.Done()
			defer func() { <-sem }()
			c, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
			if err != nil {
				fail.Add(1)
				return
			}
			ok.Add(1)
			mu.Lock()
			conns[i] = c
			mu.Unlock()
		}(i)
	}
	wg.Wait()
	log.Printf("connected=%d failed=%d", ok.Load(), fail.Load())
	if ok.Load() < int64(*n)*9/10 {
		log.Fatalf("soak failed: fewer than 90%% connections succeeded")
	}

	if *latencyRounds > 0 {
		convID, err := ensureSoakConversation(*base, tok)
		if err != nil {
			log.Fatalf("conversation: %v", err)
		}
		log.Printf("latency probes: rounds=%d conv=%s max_first=%s max_fanout=%s",
			*latencyRounds, convID, *latencyMax, *fanoutMax)
		if err := runLatencyProbes(*base, tok, convID, liveConns(&mu, conns), *latencyRounds, *latencyMax, *fanoutMax); err != nil {
			log.Fatalf("latency: %v", err)
		}
	}

	time.Sleep(*hold)

	for cycle := 1; cycle <= *reconnects; cycle++ {
		log.Printf("reconnect cycle %d/%d", cycle, *reconnects)
		mu.Lock()
		for i, c := range conns {
			if c != nil {
				_ = c.Close()
				conns[i] = nil
			}
		}
		mu.Unlock()
		time.Sleep(500 * time.Millisecond)

		var rok, rfail atomic.Int64
		var rwg sync.WaitGroup
		for i := 0; i < *n; i++ {
			rwg.Add(1)
			sem <- struct{}{}
			go func(i int) {
				defer rwg.Done()
				defer func() { <-sem }()
				c, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
				if err != nil {
					rfail.Add(1)
					return
				}
				rok.Add(1)
				mu.Lock()
				conns[i] = c
				mu.Unlock()
			}(i)
		}
		rwg.Wait()
		log.Printf("reconnect connected=%d failed=%d", rok.Load(), rfail.Load())
		if rok.Load() < int64(*n)*9/10 {
			log.Fatalf("reconnect soak failed")
		}
		time.Sleep(*hold / 2)
	}

	mu.Lock()
	for _, c := range conns {
		if c != nil {
			_ = c.Close()
		}
	}
	mu.Unlock()
	fmt.Println("SOAK OK")
	os.Exit(0)
}

func liveConns(mu *sync.Mutex, conns []*websocket.Conn) []*websocket.Conn {
	mu.Lock()
	defer mu.Unlock()
	out := make([]*websocket.Conn, 0, len(conns))
	for _, c := range conns {
		if c != nil {
			out = append(out, c)
		}
	}
	return out
}

func ensureSoakConversation(base, token string) (string, error) {
	body, err := postJSONAuth(base+"/v1/groups", token, map[string]any{
		"title": "ws-soak-" + uuid.NewString()[:8],
	})
	if err != nil {
		return "", err
	}
	id, _ := body["id"].(string)
	if id == "" {
		return "", fmt.Errorf("no conversation id: %v", body)
	}
	return id, nil
}

type latencySample struct {
	first  time.Duration
	fanout time.Duration
	got    int
}

func runLatencyProbes(base, token, convID string, conns []*websocket.Conn, rounds int, maxFirst, maxFanout time.Duration) error {
	if len(conns) == 0 {
		return fmt.Errorf("no live connections")
	}
	type hit struct {
		clientMsgID string
		at          time.Time
	}
	hits := make(chan hit, len(conns)*2)
	var readers sync.WaitGroup
	stop := make(chan struct{})
	for _, c := range conns {
		readers.Add(1)
		go func(conn *websocket.Conn) {
			defer readers.Done()
			for {
				select {
				case <-stop:
					return
				default:
				}
				_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
				_, data, err := conn.ReadMessage()
				if err != nil {
					if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
						return
					}
					// deadline / transient — keep reading until stop
					continue
				}
				var ev struct {
					Type    string         `json:"type"`
					Payload map[string]any `json:"payload"`
				}
				if json.Unmarshal(data, &ev) != nil || ev.Type != "message.new" {
					continue
				}
				cid, _ := ev.Payload["client_msg_id"].(string)
				if cid == "" {
					continue
				}
				select {
				case hits <- hit{clientMsgID: cid, at: time.Now()}:
				default:
				}
			}
		}(c)
	}
	defer func() {
		close(stop)
		// briefly drain
		time.Sleep(50 * time.Millisecond)
	}()

	samples := make([]latencySample, 0, rounds)
	need := len(conns)
	for i := 0; i < rounds; i++ {
		clientMsgID := "soak-" + uuid.NewString()
		start := time.Now()
		_, err := postJSONAuth(base+"/v1/conversations/"+convID+"/messages", token, map[string]any{
			"type":          "text",
			"body":          "soak probe " + clientMsgID,
			"client_msg_id": clientMsgID,
		})
		if err != nil {
			return fmt.Errorf("send probe %d: %w", i+1, err)
		}
		deadline := time.Now().Add(10 * time.Second)
		got := 0
		var firstAt time.Time
		var lastAt time.Time
		for got < need && time.Now().Before(deadline) {
			wait := time.Until(deadline)
			if wait <= 0 {
				break
			}
			timer := time.NewTimer(wait)
			select {
			case h := <-hits:
				timer.Stop()
				if h.clientMsgID != clientMsgID {
					continue
				}
				got++
				if firstAt.IsZero() {
					firstAt = h.at
				}
				lastAt = h.at
			case <-timer.C:
			}
		}
		if firstAt.IsZero() {
			return fmt.Errorf("probe %d: no WS delivery within timeout (got 0/%d)", i+1, need)
		}
		s := latencySample{
			first:  firstAt.Sub(start),
			fanout: lastAt.Sub(start),
			got:    got,
		}
		samples = append(samples, s)
		log.Printf("probe %d/%d first=%s fanout=%s got=%d/%d", i+1, rounds, s.first, s.fanout, s.got, need)
		if got < need*9/10 {
			return fmt.Errorf("probe %d: fan-out incomplete got=%d need≥%d", i+1, got, need*9/10)
		}
	}

	firsts := make([]time.Duration, len(samples))
	fanouts := make([]time.Duration, len(samples))
	for i, s := range samples {
		firsts[i] = s.first
		fanouts[i] = s.fanout
	}
	p50f, p95f := percentile(firsts, 50), percentile(firsts, 95)
	p50o, p95o := percentile(fanouts, 50), percentile(fanouts, 95)
	log.Printf("latency first  p50=%s p95=%s (max allowed %s)", p50f, p95f, maxFirst)
	log.Printf("latency fanout p50=%s p95=%s (max allowed %s)", p50o, p95o, maxFanout)
	if p95f > maxFirst {
		return fmt.Errorf("p95 first-delivery %s exceeds %s", p95f, maxFirst)
	}
	if p95o > maxFanout {
		return fmt.Errorf("p95 full-fanout %s exceeds %s", p95o, maxFanout)
	}
	return nil
}

func percentile(vals []time.Duration, p int) time.Duration {
	if len(vals) == 0 {
		return 0
	}
	cp := append([]time.Duration(nil), vals...)
	sort.Slice(cp, func(i, j int) bool { return cp[i] < cp[j] })
	if p <= 0 {
		return cp[0]
	}
	if p >= 100 {
		return cp[len(cp)-1]
	}
	idx := (p * (len(cp) - 1)) / 100
	return cp[idx]
}

func login(base, phone, password, invite string) (string, error) {
	capBody, err := getJSON(base + "/v1/auth/captcha")
	if err != nil {
		return "", err
	}
	payload := map[string]any{
		"phone": phone, "password": password, "invite_code": invite,
		"captcha_id": capBody["captcha_id"], "captcha": capBody["dev_answer"],
		"device_type": "web", "device_name": "ws-soak", "device_id": "ws-soak-device", "remember_me": true,
	}
	body, err := postJSON(base+"/v1/auth/login", payload)
	if err != nil {
		return "", err
	}
	tok, _ := body["access_token"].(string)
	if tok == "" {
		return "", fmt.Errorf("no access_token: %v", body)
	}
	return tok, nil
}

func toWS(base string) string {
	u, err := url.Parse(base)
	if err != nil {
		return strings.Replace(base, "http", "ws", 1)
	}
	if u.Scheme == "https" {
		u.Scheme = "wss"
	} else {
		u.Scheme = "ws"
	}
	return strings.TrimRight(u.String(), "/")
}

func getJSON(u string) (map[string]any, error) {
	res, err := http.Get(u)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	var out map[string]any
	if err := json.Unmarshal(b, &out); err != nil {
		return nil, err
	}
	if res.StatusCode >= 300 {
		return nil, fmt.Errorf("%s: %s", res.Status, string(b))
	}
	return out, nil
}

func postJSON(u string, payload map[string]any) (map[string]any, error) {
	return postJSONAuth(u, "", payload)
}

func postJSONAuth(u, token string, payload map[string]any) (map[string]any, error) {
	b, _ := json.Marshal(payload)
	req, err := http.NewRequest(http.MethodPost, u, strings.NewReader(string(b)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	if res.StatusCode >= 300 {
		return nil, fmt.Errorf("%s: %s", res.Status, string(raw))
	}
	return out, nil
}
