package ws

import (
	"sync/atomic"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// ClientSendBuffer is the per-connection outbound queue depth.
// Sized for busy group fan-out under ~1k concurrent sockets without silent drops.
const ClientSendBuffer = 256

var (
	wsSendDrops = promauto.NewCounter(prometheus.CounterOpts{
		Name: "qchat_ws_send_drops_total",
		Help: "WebSocket outbound frames dropped because a client send buffer was full",
	})
	wsSendDropCount atomic.Uint64
)

func incSendDrops(n uint64) {
	if n == 0 {
		return
	}
	wsSendDrops.Add(float64(n))
	wsSendDropCount.Add(n)
}

// SendDropCount returns dropped outbound frames since process start (tests / debug).
func SendDropCount() uint64 {
	return wsSendDropCount.Load()
}
