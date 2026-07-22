.PHONY: infra-up infra-down media api web admin desktop mobile test test-api test-e2e migrate seed generate check-openapi redeploy

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
	cd apps/admin && npm run dev

desktop:
	cd apps/desktop && npm run dev

mobile:
	cd apps/mobile && npx expo start

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

test: test-api check-openapi smoke
	cd apps/web && npm run typecheck
