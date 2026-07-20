package ws

import (
	"encoding/json"
	"sync"

	"github.com/gorilla/websocket"
)

type Event struct {
	Type    string `json:"type"`
	Payload any    `json:"payload"`
}

type Client struct {
	UserID         string
	EnterpriseID   string
	SessionID      string
	Conn           *websocket.Conn
	Send           chan []byte
}

type Hub struct {
	mu      sync.RWMutex
	clients map[string]map[*Client]struct{} // userID -> clients
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

func (h *Hub) PublishToUsers(userIDs []string, ev Event) {
	b, err := json.Marshal(ev)
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	seen := map[*Client]struct{}{}
	for _, uid := range userIDs {
		for c := range h.clients[uid] {
			if _, ok := seen[c]; ok {
				continue
			}
			seen[c] = struct{}{}
			select {
			case c.Send <- b:
			default:
			}
		}
	}
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
