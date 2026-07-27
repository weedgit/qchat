package redisx

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/redis/go-redis/v9"
)

// Connect opens a Redis client when url is non-empty. Returns nil if Redis is
// unreachable so the API can keep running in single-node mode.
func Connect(ctx context.Context, url string) (*redis.Client, error) {
	if url == "" {
		return nil, nil
	}
	opts, err := redis.ParseURL(url)
	if err != nil {
		return nil, fmt.Errorf("parse redis url: %w", err)
	}
	client := redis.NewClient(opts)
	pingCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if err := client.Ping(pingCtx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("redis ping: %w", err)
	}
	return client, nil
}

// MustConnectOrNil logs and returns nil when Redis is optional/unavailable.
func MustConnectOrNil(ctx context.Context, url string) *redis.Client {
	client, err := Connect(ctx, url)
	if err != nil {
		log.Printf("redis: unavailable (%v); continuing with in-process hub/revoke only", err)
		return nil
	}
	if client != nil {
		log.Printf("redis: connected")
	}
	return client
}
