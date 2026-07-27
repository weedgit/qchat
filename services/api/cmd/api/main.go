package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/qchat/qchat/services/api/internal/config"
	"github.com/qchat/qchat/services/api/internal/db"
	"github.com/qchat/qchat/services/api/internal/migrate"
	"github.com/qchat/qchat/services/api/internal/redisx"
	"github.com/qchat/qchat/services/api/internal/server"
	"github.com/qchat/qchat/services/api/internal/ws"
)

func main() {
	migrateOnly := flag.Bool("migrate-only", false, "run migrations and exit")
	flag.Parse()

	cfg := config.Load()
	cfg.MigrateOnly = *migrateOnly
	if err := cfg.ValidateSecrets(); err != nil {
		log.Fatalf("config: %v", err)
	}
	ctx := context.Background()

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()

	if err := migrate.Up(ctx, pool); err != nil {
		log.Fatalf("migrate: %v", err)
	}
	if cfg.MigrateOnly {
		log.Println("migrations applied")
		return
	}

	hub := ws.NewHub()
	srv := server.New(cfg, pool, hub)
	runCtx, runCancel := context.WithCancel(context.Background())
	defer runCancel()
	if rdb := redisx.MustConnectOrNil(runCtx, cfg.RedisURL); rdb != nil {
		srv.AttachRedis(runCtx, rdb)
		defer rdb.Close()
	}
	srv.StartRetentionLoop(runCtx, 24*time.Hour)

	httpServer := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("qchat api listening on %s", cfg.HTTPAddr)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	runCancel()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(shutdownCtx)
}
