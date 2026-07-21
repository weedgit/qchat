.PHONY: infra-up infra-down api web admin desktop test test-api test-e2e migrate seed generate check-openapi redeploy

infra-up:
	docker compose up -d

infra-down:
	docker compose down

api:
	cd services/api && go run ./cmd/api

web:
	cd apps/web && npm run dev

admin:
	cd apps/admin && npm run dev

desktop:
	cd apps/desktop && npm run dev

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
