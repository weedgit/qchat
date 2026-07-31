// Command ws_soak opens many WebSocket sessions against the API to validate
// ≥1000 concurrent online connections, reconnect churn, and message fan-out
// latency (working SLO: p95 first delivery ≤ 1s).
//
// Single-user (legacy — one account, many sockets):
//
//	go run ./cmd/ws_soak -n 1000 -base http://localhost:8080
//
// Multi-user (distinct accounts in one group — closer to real concurrency):
//
//	go run ./cmd/ws_soak -n 200 -users 50 -base http://localhost:8080
//
// Dual API + Redis (cross-node fan-out; both bases must share Redis):
//
//	go run ./cmd/ws_soak -n 100 -users 20 \
//	  -base http://localhost:8080 -base2 http://localhost:8081
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
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type soakUser struct {
	token  string
	userID string
	phone  string
}

type sockSlot struct {
	conn *websocket.Conn
	base string
	tok  string
	uid  string
}

func main() {
	n := flag.Int("n", 1000, "total concurrent WebSocket connections")
	users := flag.Int("users", 1, "distinct users (≥2 registers soak accounts and builds a real group)")
	base := flag.String("base", "http://localhost:8080", "primary API base URL")
	base2 := flag.String("base2", "", "optional second API base (Redis multi-node fan-out)")
	token := flag.String("token", "", "access token when -users=1 (optional if phone/password set)")
	phone := flag.String("phone", "13800000002", "login phone when -users=1")
	password := flag.String("password", "user12345", "password for login/register")
	invite := flag.String("invite", "ACME2026", "enterprise invite code")
	hold := flag.Duration("hold", 5*time.Second, "hold connections open after latency probes")
	reconnects := flag.Int("reconnects", 1, "disconnect/reconnect cycles after initial hold")
	latencyRounds := flag.Int("latency-rounds", 20, "message fan-out probes (0 to skip)")
	latencyMax := flag.Duration("latency-max", time.Second, "fail if p95 first-delivery latency exceeds this")
	fanoutMax := flag.Duration("fanout-max", 2*time.Second, "fail if p95 full-fanout latency exceeds this")
	dialConcurrency := flag.Int("dial-concurrency", 64, "max parallel WS dials")
	checkMetrics := flag.Bool("check-metrics", true, "assert WS send-drop counter stays within budget")
	maxDrops := flag.Float64("max-drops", 50, "max allowed increase in qchat_ws_send_drops_total during soak")
	flag.Parse()

	if *n < 1 {
		log.Fatal("-n must be ≥ 1")
	}
	if *users < 1 {
		log.Fatal("-users must be ≥ 1")
	}
	if *users > *n {
		log.Fatalf("-users (%d) cannot exceed -n (%d)", *users, *n)
	}
	if *dialConcurrency < 1 {
		*dialConcurrency = 1
	}

	bases := []string{strings.TrimRight(*base, "/")}
	if strings.TrimSpace(*base2) != "" {
		bases = append(bases, strings.TrimRight(*base2, "/"))
	}

	dropsBefore := 0.0
	if *checkMetrics {
		if d, err := scrapeMetric(bases[0]+"/metrics", "qchat_ws_send_drops_total"); err == nil {
			dropsBefore = d
		} else {
			log.Printf("metrics: could not read drops before soak: %v (continuing)", err)
		}
	}

	accounts, err := prepareAccounts(*users, bases[0], *token, *phone, *password, *invite)
	if err != nil {
		log.Fatalf("accounts: %v", err)
	}
	log.Printf("accounts=%d bases=%v connections=%d", len(accounts), bases, *n)

	convID := ""
	senderTok := accounts[0].token
	if *latencyRounds > 0 {
		memberIDs := make([]string, 0, len(accounts)-1)
		for i := 1; i < len(accounts); i++ {
			memberIDs = append(memberIDs, accounts[i].userID)
		}
		convID, err = ensureSoakConversation(bases[0], senderTok, memberIDs)
		if err != nil {
			log.Fatalf("conversation: %v", err)
		}
		log.Printf("soak group conv=%s members=%d", convID, len(accounts))
	}

	slots := make([]*sockSlot, *n)
	var mu sync.Mutex
	var ok, fail atomic.Int64
	sem := make(chan struct{}, *dialConcurrency)

	dialAll := func() {
		var wg sync.WaitGroup
		for i := 0; i < *n; i++ {
			wg.Add(1)
			sem <- struct{}{}
			go func(i int) {
				defer wg.Done()
				defer func() { <-sem }()
				acct := accounts[i%len(accounts)]
				apiBase := bases[i%len(bases)]
				wsURL := toWS(apiBase) + "/v1/ws?token=" + url.QueryEscape(acct.token)
				c, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
				if err != nil {
					fail.Add(1)
					return
				}
				ok.Add(1)
				mu.Lock()
				slots[i] = &sockSlot{conn: c, base: apiBase, tok: acct.token, uid: acct.userID}
				mu.Unlock()
			}(i)
		}
		wg.Wait()
	}

	log.Printf("opening %d connections (dial concurrency %d)", *n, *dialConcurrency)
	dialAll()
	log.Printf("connected=%d failed=%d", ok.Load(), fail.Load())
	if ok.Load() < int64(*n)*9/10 {
		log.Fatalf("soak failed: fewer than 90%% connections succeeded")
	}

	if *latencyRounds > 0 {
		live := liveSlots(&mu, slots)
		log.Printf("latency probes: rounds=%d conv=%s listeners=%d max_first=%s max_fanout=%s",
			*latencyRounds, convID, len(live), *latencyMax, *fanoutMax)
		if err := runLatencyProbes(bases[0], senderTok, convID, live, *latencyRounds, *latencyMax, *fanoutMax); err != nil {
			log.Fatalf("latency: %v", err)
		}
	}

	time.Sleep(*hold)

	for cycle := 1; cycle <= *reconnects; cycle++ {
		log.Printf("reconnect cycle %d/%d", cycle, *reconnects)
		mu.Lock()
		for i, s := range slots {
			if s != nil && s.conn != nil {
				_ = s.conn.Close()
			}
			slots[i] = nil
		}
		mu.Unlock()
		time.Sleep(500 * time.Millisecond)
		ok.Store(0)
		fail.Store(0)
		dialAll()
		log.Printf("reconnect connected=%d failed=%d", ok.Load(), fail.Load())
		if ok.Load() < int64(*n)*9/10 {
			log.Fatalf("reconnect soak failed")
		}
		time.Sleep(*hold / 2)
	}

	mu.Lock()
	for _, s := range slots {
		if s != nil && s.conn != nil {
			_ = s.conn.Close()
		}
	}
	mu.Unlock()

	if *checkMetrics {
		if d, err := scrapeMetric(bases[0]+"/metrics", "qchat_ws_send_drops_total"); err == nil {
			delta := d - dropsBefore
			log.Printf("metrics: qchat_ws_send_drops_total delta=%.0f (max %.0f)", delta, *maxDrops)
			if delta > *maxDrops {
				log.Fatalf("too many WS send drops during soak: %.0f > %.0f", delta, *maxDrops)
			}
		} else {
			log.Printf("metrics: could not read drops after soak: %v", err)
		}
	}

	fmt.Println("SOAK OK")
	os.Exit(0)
}

func prepareAccounts(userCount int, base, token, phone, password, invite string) ([]soakUser, error) {
	if userCount == 1 {
		tok := token
		if tok == "" {
			var err error
			tok, err = login(base, phone, password, invite)
			if err != nil {
				return nil, err
			}
			log.Printf("logged in as %s", phone)
		}
		uid, err := fetchMeID(base, tok)
		if err != nil {
			// Still usable for single-user empty-group soak.
			log.Printf("me: %v (continuing without user id)", err)
		}
		return []soakUser{{token: tok, userID: uid, phone: phone}}, nil
	}

	out := make([]soakUser, 0, userCount)
	for i := 0; i < userCount; i++ {
		u, err := registerSoakUser(base, password, invite, i)
		if err != nil {
			return nil, fmt.Errorf("register user %d: %w", i, err)
		}
		out = append(out, u)
		if (i+1)%10 == 0 || i+1 == userCount {
			log.Printf("registered %d/%d users", i+1, userCount)
		}
	}
	return out, nil
}

func registerSoakUser(base, password, invite string, idx int) (soakUser, error) {
	phone := fmt.Sprintf("137%08d", (time.Now().UnixNano()+int64(idx))%100000000)
	username := "soak" + uuid.NewString()[:8]

	cap1, err := getJSON(base + "/v1/auth/captcha")
	if err != nil {
		return soakUser{}, err
	}
	body, err := postJSON(base+"/v1/auth/register", map[string]any{
		"phone": phone, "password": password, "username": username,
		"captcha_id": cap1["captcha_id"], "captcha": captchaAnswer(cap1),
		"invite_code": invite,
		"device_type": "web", "device_name": "ws-soak", "device_id": "soak-" + username,
		"remember_me": true,
	})
	if err != nil {
		return soakUser{}, err
	}
	tok, _ := body["access_token"].(string)
	uid, _ := body["user_id"].(string)
	if tok == "" || uid == "" {
		return soakUser{}, fmt.Errorf("register response missing token/user_id: %v", body)
	}
	return soakUser{token: tok, userID: uid, phone: phone}, nil
}

func captchaAnswer(cap map[string]any) any {
	if v, ok := cap["dev_answer"]; ok && v != nil {
		return v
	}
	return cap["challenge"]
}

func fetchMeID(base, token string) (string, error) {
	req, err := http.NewRequest(http.MethodGet, base+"/v1/me", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	if res.StatusCode >= 300 {
		return "", fmt.Errorf("%s: %s", res.Status, string(raw))
	}
	id, _ := out["id"].(string)
	return id, nil
}

func liveSlots(mu *sync.Mutex, slots []*sockSlot) []*sockSlot {
	mu.Lock()
	defer mu.Unlock()
	out := make([]*sockSlot, 0, len(slots))
	for _, s := range slots {
		if s != nil && s.conn != nil {
			out = append(out, s)
		}
	}
	return out
}

func ensureSoakConversation(base, token string, memberIDs []string) (string, error) {
	payload := map[string]any{
		"title": "ws-soak-" + uuid.NewString()[:8],
	}
	if len(memberIDs) > 0 {
		payload["member_ids"] = memberIDs
	}
	body, err := postJSONAuth(base+"/v1/groups", token, payload)
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

func runLatencyProbes(base, token, convID string, slots []*sockSlot, rounds int, maxFirst, maxFanout time.Duration) error {
	if len(slots) == 0 {
		return fmt.Errorf("no live connections")
	}
	type hit struct {
		clientMsgID string
		at          time.Time
	}
	// Large buffer so we never silently drop hits under 1k sockets.
	hits := make(chan hit, len(slots)*rounds*2+64)
	var hitDrops atomic.Int64
	var readers sync.WaitGroup
	stop := make(chan struct{})
	for _, s := range slots {
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
					hitDrops.Add(1)
				}
			}
		}(s.conn)
	}
	defer func() {
		close(stop)
		time.Sleep(50 * time.Millisecond)
	}()

	samples := make([]latencySample, 0, rounds)
	need := len(slots)
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
		deadline := time.Now().Add(15 * time.Second)
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

	if hitDrops.Load() > 0 {
		return fmt.Errorf("harness dropped %d hit samples (buffer pressure)", hitDrops.Load())
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

func scrapeMetric(metricsURL, name string) (float64, error) {
	res, err := http.Get(metricsURL)
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return 0, err
	}
	if res.StatusCode >= 300 {
		return 0, fmt.Errorf("%s", res.Status)
	}
	// Match plain counters: name 123 or name{...} 123
	re := regexp.MustCompile(`(?m)^` + regexp.QuoteMeta(name) + `(?:\{[^}]*\})?\s+([0-9.eE+-]+)`)
	m := re.FindSubmatch(raw)
	if m == nil {
		return 0, fmt.Errorf("metric %s not found", name)
	}
	return strconv.ParseFloat(string(m[1]), 64)
}

func login(base, phone, password, invite string) (string, error) {
	capBody, err := getJSON(base + "/v1/auth/captcha")
	if err != nil {
		return "", err
	}
	payload := map[string]any{
		"phone": phone, "password": password, "invite_code": invite,
		"captcha_id": capBody["captcha_id"], "captcha": captchaAnswer(capBody),
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
