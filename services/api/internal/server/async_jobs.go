package server

import "log"

// Bounded async workers for push and presence so reconnect / chat storms
// cannot spawn unlimited concurrent DB+vendor work.

const (
	pushWorkerSlots     = 64
	presenceWorkerSlots = 32
)

var (
	pushSem     = make(chan struct{}, pushWorkerSlots)
	presenceSem = make(chan struct{}, presenceWorkerSlots)
)

// goPushJob runs fn with at most pushWorkerSlots concurrent executions.
// Goroutines may queue briefly on the semaphore under load.
func (s *Server) goPushJob(fn func()) {
	go func() {
		pushSem <- struct{}{}
		defer func() { <-pushSem }()
		fn()
	}()
}

// goPresenceJob tries to run presence fan-out without blocking the WS pumps.
// If the pool is saturated, the update is skipped (a later connect/disconnect
// will publish again).
func (s *Server) goPresenceJob(fn func()) {
	select {
	case presenceSem <- struct{}{}:
		go func() {
			defer func() { <-presenceSem }()
			fn()
		}()
	default:
		log.Printf("presence: worker pool full; skipping broadcast")
	}
}
