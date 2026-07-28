package ws

import (
	"encoding/json"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
)

type Event struct {
	Type    string `json:"type"`
	Payload any    `json:"payload"`
}

type Client struct {
	UserID       string
	EnterpriseID string
	SessionID    string
	DeviceID     string
	Conn         *websocket.Conn
	Send         chan []byte
}

type Hub struct {
	mu      sync.RWMutex
	clients map[string]map[*Client]struct{} // userID -> clients
	rdb     *redis.Client
	origin  string
}

func NewHub() *Hub {
	return &Hub{clients: map[string]map[*Client]struct{}{}}
}

func (h *Hub) Register(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.clients[c.UserID] == nil {
		h.clients[c.UserID] = map[*Client]struct{}{}
	}
	h.clients[c.UserID][c] = struct{}{}
}

func (h *Hub) Unregister(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if m := h.clients[c.UserID]; m != nil {
		delete(m, c)
		if len(m) == 0 {
			delete(h.clients, c.UserID)
		}
	}
	close(c.Send)
}

func (h *Hub) publishLocked(targets []*Client, b []byte) {
	seen := map[*Client]struct{}{}
	for _, c := range targets {
		if c == nil {
			continue
		}
		if _, ok := seen[c]; ok {
			continue
		}
		seen[c] = struct{}{}
		select {
		case c.Send <- b:
		default:
			incSendDrops(1)
		}
	}
}

func (h *Hub) clientsForUsers(userIDs []string) []*Client {
	out := make([]*Client, 0)
	seen := map[*Client]struct{}{}
	for _, uid := range userIDs {
		for c := range h.clients[uid] {
			if _, ok := seen[c]; ok {
				continue
			}
			seen[c] = struct{}{}
			out = append(out, c)
		}
	}
	return out
}

func (h *Hub) publishToUsersLocal(userIDs []string, ev Event) {
	b, err := json.Marshal(ev)
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	h.publishLocked(h.clientsForUsers(userIDs), b)
}

func (h *Hub) PublishToUsers(userIDs []string, ev Event) {
	h.publishToUsersLocal(userIDs, ev)
	h.broadcast(clusterEnvelope{Kind: "users", UserIDs: userIDs, Event: ev})
}

func (h *Hub) publishToUserDeviceLocal(userID, deviceID string, ev Event) {
	b, err := json.Marshal(ev)
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	var targets []*Client
	for c := range h.clients[userID] {
		if deviceID == "" || c.DeviceID == "" || c.DeviceID == deviceID {
			targets = append(targets, c)
		}
	}
	if deviceID != "" {
		exact := make([]*Client, 0, len(targets))
		for _, c := range targets {
			if c.DeviceID == deviceID {
				exact = append(exact, c)
			}
		}
		if len(exact) > 0 {
			targets = exact
		}
	}
	h.publishLocked(targets, b)
}

// PublishToUserDevice sends only to WS clients for userID with matching deviceID.
// Empty deviceID falls back to all of that user's connections (legacy tokens).
func (h *Hub) PublishToUserDevice(userID, deviceID string, ev Event) {
	h.publishToUserDeviceLocal(userID, deviceID, ev)
	h.broadcast(clusterEnvelope{Kind: "device", UserID: userID, DeviceID: deviceID, Event: ev})
}

func (h *Hub) publishToUserExceptDeviceLocal(userID, deviceID string, ev Event) {
	b, err := json.Marshal(ev)
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	var targets []*Client
	for c := range h.clients[userID] {
		if deviceID != "" && c.DeviceID == deviceID {
			continue
		}
		targets = append(targets, c)
	}
	h.publishLocked(targets, b)
}

// PublishToUserExceptDevice notifies other devices of the same user (e.g. call answered elsewhere).
func (h *Hub) PublishToUserExceptDevice(userID, deviceID string, ev Event) {
	h.publishToUserExceptDeviceLocal(userID, deviceID, ev)
	h.broadcast(clusterEnvelope{Kind: "except_device", UserID: userID, DeviceID: deviceID, Event: ev})
}

func (h *Hub) OnlineUserIDs(ids []string) map[string]bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	out := map[string]bool{}
	for _, id := range ids {
		out[id] = len(h.clients[id]) > 0
	}
	return out
}

func (h *Hub) IsOnline(userID string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients[userID]) > 0
}

func (h *Hub) ConnectionCount(userID string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients[userID])
}

func (h *Hub) TotalConnections() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	n := 0
	for _, m := range h.clients {
		n += len(m)
	}
	return n
}

func (h *Hub) kickSessionsLocal(sessionIDs []string, ev Event) {
	if len(sessionIDs) == 0 {
		return
	}
	want := make(map[string]struct{}, len(sessionIDs))
	for _, id := range sessionIDs {
		id = strings.TrimSpace(id)
		if id != "" {
			want[id] = struct{}{}
		}
	}
	if len(want) == 0 {
		return
	}
	b, err := json.Marshal(ev)
	if err != nil {
		return
	}
	h.mu.RLock()
	victims := make([]*Client, 0)
	for _, m := range h.clients {
		for c := range m {
			if _, ok := want[c.SessionID]; ok {
				victims = append(victims, c)
			}
		}
	}
	h.mu.RUnlock()
	for _, c := range victims {
		select {
		case c.Send <- b:
		default:
			incSendDrops(1)
		}
		go func(cl *Client) {
			time.Sleep(80 * time.Millisecond)
			_ = cl.Conn.Close()
		}(c)
	}
}

// KickSessions notifies matching clients then closes their sockets (same-type login / admin revoke).
func (h *Hub) KickSessions(sessionIDs []string, ev Event) {
	h.kickSessionsLocal(sessionIDs, ev)
	h.broadcast(clusterEnvelope{Kind: "kick", SessionIDs: sessionIDs, Event: ev})
}
