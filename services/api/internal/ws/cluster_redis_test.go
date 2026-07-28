package ws_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/gorilla/websocket"
	"github.com/qchat/qchat/services/api/internal/ws"
	"github.com/redis/go-redis/v9"
)

func TestRedisFanoutDeliversToPeerHub(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	rdbA := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	rdbB := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer rdbA.Close()
	defer rdbB.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	hubA := ws.NewHub()
	hubB := ws.NewHub()
	hubA.AttachRedis(ctx, rdbA)
	hubB.AttachRedis(ctx, rdbB)

	// Give subscribers a moment to subscribe; Redis publish is async off the request path.
	time.Sleep(80 * time.Millisecond)

	recv := make(chan []byte, 1)
	client := &ws.Client{
		UserID: "user-b",
		Send:   make(chan []byte, 4),
		Conn:   &websocket.Conn{}, // unused; Kick closes it — avoid Kick in this test
	}
	hubB.Register(client)
	defer hubB.Unregister(client)

	go func() {
		select {
		case b := <-client.Send:
			recv <- b
		case <-time.After(2 * time.Second):
		}
	}()

	hubA.PublishToUsers([]string{"user-b"}, ws.Event{
		Type:    "message.new",
		Payload: map[string]any{"body": "hello"},
	})

	select {
	case b := <-recv:
		var ev ws.Event
		if err := json.Unmarshal(b, &ev); err != nil {
			t.Fatal(err)
		}
		if ev.Type != "message.new" {
			t.Fatalf("got %#v", ev)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("peer hub did not receive redis fan-out event")
	}
}
