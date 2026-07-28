package ws

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

const redisWSChannel = "qchat:ws"

// clusterEnvelope is published on Redis so peer API processes can deliver WS
// events to locally connected clients (Mattermost-style publish-then-peers).
type clusterEnvelope struct {
	Origin     string   `json:"origin"`
	Kind       string   `json:"kind"` // users | device | except_device | kick
	UserIDs    []string `json:"user_ids,omitempty"`
	UserID     string   `json:"user_id,omitempty"`
	DeviceID   string   `json:"device_id,omitempty"`
	SessionIDs []string `json:"session_ids,omitempty"`
	Event      Event    `json:"event"`
}

// AttachRedis enables cross-instance fan-out on this hub. Safe to call with nil.
func (h *Hub) AttachRedis(ctx context.Context, rdb *redis.Client) {
	if h == nil || rdb == nil {
		return
	}
	h.mu.Lock()
	h.rdb = rdb
	if h.origin == "" {
		h.origin = uuid.NewString()
	}
	h.mu.Unlock()
	go h.subscribeRedis(ctx)
}

func (h *Hub) broadcast(env clusterEnvelope) {
	h.mu.RLock()
	rdb := h.rdb
	origin := h.origin
	h.mu.RUnlock()
	if rdb == nil {
		return
	}
	env.Origin = origin
	b, err := json.Marshal(env)
	if err != nil {
		return
	}
	// Publish off the request path so Redis jitter does not block local WS delivery.
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := rdb.Publish(ctx, redisWSChannel, b).Err(); err != nil {
			log.Printf("redis ws publish: %v", err)
		}
	}()
}

func (h *Hub) subscribeRedis(ctx context.Context) {
	h.mu.RLock()
	rdb := h.rdb
	origin := h.origin
	h.mu.RUnlock()
	if rdb == nil {
		return
	}
	sub := rdb.Subscribe(ctx, redisWSChannel)
	defer sub.Close()
	ch := sub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			var env clusterEnvelope
			if json.Unmarshal([]byte(msg.Payload), &env) != nil {
				continue
			}
			if env.Origin == origin {
				continue // skip own publishes
			}
			h.applyCluster(env)
		}
	}
}

func (h *Hub) applyCluster(env clusterEnvelope) {
	switch env.Kind {
	case "users":
		h.publishToUsersLocal(env.UserIDs, env.Event)
	case "device":
		h.publishToUserDeviceLocal(env.UserID, env.DeviceID, env.Event)
	case "except_device":
		h.publishToUserExceptDeviceLocal(env.UserID, env.DeviceID, env.Event)
	case "kick":
		h.kickSessionsLocal(env.SessionIDs, env.Event)
	}
}
