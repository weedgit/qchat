package main

import (
	"context"
	"log"

	"github.com/google/uuid"
	"github.com/qchat/qchat/services/api/internal/auth"
	"github.com/qchat/qchat/services/api/internal/config"
	"github.com/qchat/qchat/services/api/internal/db"
	"github.com/qchat/qchat/services/api/internal/migrate"
)

func main() {
	cfg := config.Load()
	ctx := context.Background()
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()
	if err := migrate.Up(ctx, pool); err != nil {
		log.Fatal(err)
	}

	entA := uuid.New()
	entB := uuid.New()
	_, _ = pool.Exec(ctx, `INSERT INTO enterprises(id, name, invite_code) VALUES ($1,'Acme Corp','ACME2026') ON CONFLICT (invite_code) DO NOTHING`, entA)
	_, _ = pool.Exec(ctx, `INSERT INTO enterprises(id, name, invite_code) VALUES ($1,'Beta Ltd','BETA2026') ON CONFLICT (invite_code) DO NOTHING`, entB)

	// resolve actual IDs
	_ = pool.QueryRow(ctx, `SELECT id FROM enterprises WHERE invite_code='ACME2026'`).Scan(&entA)
	_ = pool.QueryRow(ctx, `SELECT id FROM enterprises WHERE invite_code='BETA2026'`).Scan(&entB)

	ownerHash, _ := auth.HashPassword("admin12345")
	adminHash, _ := auth.HashPassword("admin12345")
	userHash, _ := auth.HashPassword("user12345")

	_, _ = pool.Exec(ctx, `
		INSERT INTO users(enterprise_id, phone, password_hash, username, display_name, role)
		VALUES ($1,'10000000000',$2,'platform','Platform Owner','platform_owner')
		ON CONFLICT (enterprise_id, phone) DO NOTHING`, entA, ownerHash)
	_, _ = pool.Exec(ctx, `
		INSERT INTO users(enterprise_id, phone, password_hash, username, display_name, role)
		VALUES ($1,'13800000001',$2,'acme_admin','Acme Admin','enterprise_admin')
		ON CONFLICT (enterprise_id, phone) DO NOTHING`, entA, adminHash)
	_, _ = pool.Exec(ctx, `
		INSERT INTO users(enterprise_id, phone, password_hash, username, display_name, role)
		VALUES ($1,'13800000002',$2,'alice','Alice','member')
		ON CONFLICT (enterprise_id, phone) DO NOTHING`, entA, userHash)
	_, _ = pool.Exec(ctx, `
		INSERT INTO users(enterprise_id, phone, password_hash, username, display_name, role)
		VALUES ($1,'13800000003',$2,'bob','Bob','member')
		ON CONFLICT (enterprise_id, phone) DO NOTHING`, entA, userHash)
	_, _ = pool.Exec(ctx, `
		INSERT INTO users(enterprise_id, phone, password_hash, username, display_name, role)
		VALUES ($1,'13800000004',$2,'compliance','Compliance Officer','compliance')
		ON CONFLICT (enterprise_id, phone) DO NOTHING`, entA, adminHash)
	_, _ = pool.Exec(ctx, `
		INSERT INTO users(enterprise_id, phone, password_hash, username, display_name, role)
		VALUES ($1,'13800000005',$2,'support','Support Agent','support')
		ON CONFLICT (enterprise_id, phone) DO NOTHING`, entA, adminHash)
	_, _ = pool.Exec(ctx, `
		INSERT INTO users(enterprise_id, phone, password_hash, username, display_name, role)
		VALUES ($1,'13800000006',$2,'readonly','Read Only','read_only')
		ON CONFLICT (enterprise_id, phone) DO NOTHING`, entA, adminHash)

	log.Println("seed complete")
	log.Println("Enterprise A invite: ACME2026")
	log.Println("Enterprise B invite: BETA2026")
	log.Println("Admin phone 13800000001 / admin12345")
	log.Println("Users alice/bob phones 13800000002|13800000003 / user12345")
	log.Println("Console roles: compliance 13800000004, support 13800000005, read_only 13800000006 / admin12345")
}
