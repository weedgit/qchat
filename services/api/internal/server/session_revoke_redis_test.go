package server

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestRevokedSessionSharedViaRedis(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer rdb.Close()

	a := &Server{}
	b := &Server{}
	a.attachRevokeRedis(rdb)
	b.attachRevokeRedis(rdb)

	sid := "11111111-1111-1111-1111-111111111111"
	a.markSessionsRevokedAll([]string{sid})

	// Wait for SET to be visible
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if b.sessionAccessRevokedAny(sid) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("peer server did not see redis revoke marker")
}

func TestRevokeRedisNoopWithoutClient(t *testing.T) {
	s := &Server{}
	s.markSessionsRevokedAll([]string{"x"})
	if s.sessionRevokedInRedis("x") {
		t.Fatal("expected false without redis")
	}
	_ = context.Background()
}
