package ws

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestKickSessionsSendsEventAndCloses(t *testing.T) {
	hub := NewHub()
	upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Errorf("upgrade: %v", err)
			return
		}
		c := &Client{
			UserID:    "u1",
			SessionID: "sess-old",
			Conn:      conn,
			Send:      make(chan []byte, 8),
		}
		hub.Register(c)
		go func() {
			for msg := range c.Send {
				_ = conn.WriteMessage(websocket.TextMessage, msg)
			}
		}()
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				hub.Unregister(c)
				_ = conn.Close()
				return
			}
		}
	}))
	defer server.Close()

	wsURL := "ws" + server.URL[len("http"):]
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	hub.KickSessions([]string{"sess-old"}, Event{
		Type:    "session.revoked",
		Payload: map[string]any{"reason": "replaced"},
	})

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read kick event: %v", err)
	}
	var ev Event
	if err := json.Unmarshal(data, &ev); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if ev.Type != "session.revoked" {
		t.Fatalf("type=%q", ev.Type)
	}
}
