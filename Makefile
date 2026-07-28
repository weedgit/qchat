.PHONY: infra-up infra-down media api web admin admin-dev desktop desktop-check desktop-pack desktop-dist-win-docker mobile mobile-typecheck mobile-check-release test test-api test-e2e migrate seed generate check-openapi redeploy soak soak-multi

infra-up:
	./deploy/render-media-config.sh
	set -a; . ./deploy/generated/media.env; set +a; docker compose up -d

infra-down:
	docker compose down

media:
	./deploy/up-media.sh

api:
	cd services/api && go run ./cmd/api

web:
	./deploy/render-media-config.sh
	cd apps/web && npm run dev

admin:
	cd apps/admin && NEXT_PUBLIC_API_URL= npm run build
	@echo "Admin static export: apps/admin/out/ → https://<host>/admin/"

admin-dev:
	cd apps/admin && npm run dev

desktop:
	cd apps/desktop && npm run dev

desktop-check:
	cd apps/desktop && npm run check

desktop-pack:
	cd apps/desktop && npm run pack

desktop-dist-win-docker:
	cd apps/desktop && npm run dist:win:docker

mobile:
	cd apps/mobile && npx expo start

mobile-typecheck:
	cd apps/mobile && npm run typecheck

mobile-check-release:
	cd apps/mobile && npm run check:release

migrate:
	cd services/api && go run ./cmd/api -migrate-only

seed:
	cd services/api && go run ./cmd/seed

generate:
	cd packages/shared && npm run generate

check-openapi:
	cd packages/shared && npm run check

test-api:
	cd services/api && go test ./...

test-e2e:
	cd apps/web && npm run test:e2e:install && npm run test:e2e

smoke:
	bash deploy/smoke-core.sh

redeploy:
	bash deploy/redeploy.sh

soak:
	bash deploy/soak.sh

soak-multi:
	bash deploy/soak.sh --multi

test: test-api check-openapi smoke
	cd apps/web && npm run typecheck
