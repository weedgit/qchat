// Command ws_soak opens many WebSocket sessions against the API to validate
// ≥1000 concurrent online connections and optional reconnect churn.
//
// Usage:
//
//	go run ./cmd/ws_soak -n 1000 -base http://localhost:8080 \
//	  -phone 13800000002 -password user12345 -invite ACME2026
//
// Or pass an existing access token:
//
//	go run ./cmd/ws_soak -n 1000 -token "$ACCESS" -base http://localhost:8080
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
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

func main() {
	n := flag.Int("n", 1000, "concurrent WebSocket connections")
	base := flag.String("base", "http://localhost:8080", "API base URL")
	token := flag.String("token", "", "access token (optional if phone/password set)")
	phone := flag.String("phone", "13800000002", "login phone")
	password := flag.String("password", "user12345", "login password")
	invite := flag.String("invite", "ACME2026", "invite code for login")
	hold := flag.Duration("hold", 15*time.Second, "how long to hold connections open")
	reconnects := flag.Int("reconnects", 2, "disconnect/reconnect cycles after initial hold")
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

func login(base, phone, password, invite string) (string, error) {
	capBody, err := getJSON(base + "/v1/auth/captcha")
	if err != nil {
		return "", err
	}
	payload := map[string]any{
		"phone": phone, "password": password, "invite_code": invite,
		"captcha_id": capBody["captcha_id"], "captcha": capBody["challenge"],
		"device_type": "desktop", "device_name": "ws-soak", "remember_me": true,
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
	b, _ := json.Marshal(payload)
	res, err := http.Post(u, "application/json", strings.NewReader(string(b)))
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
