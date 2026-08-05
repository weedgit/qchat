.PHONY: infra-up infra-down media api web admin admin-dev desktop desktop-check desktop-pack desktop-dist-win-docker mobile mobile-typecheck mobile-check-release xin-web xin-mobile xin-desktop xin-icons xin-redeploy xin-mobile-check-release xin-mobile-bootstrap xin-mobile-eas-onboard xin-mobile-eas-preview wait-eas-xin-apk xin-desktop-dist-linux xin-desktop-dist-win-docker sync-xin-desktop-updates publish-xin publish-xin-linux publish-xin-full setup-xin smoke-xin sync-hosts test test-api test-e2e migrate seed generate check-openapi redeploy soak soak-multi

sync-hosts:
	node scripts/sync-hosts-env.js

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

xin-web:
	cd apps/xin-web && npm run dev

xin-mobile:
	cd apps/xin-mobile && npx expo start

xin-mobile-check-release:
	cd apps/xin-mobile && npm run check:release

xin-mobile-eas-onboard:
	cd apps/xin-mobile && npm run eas:onboard

make xin-mobile-bootstrap:
	cd apps/xin-mobile && npm run bootstrap

xin-mobile-eas-preview:
	cd apps/xin-mobile && npm run eas:build:preview:cloud

wait-eas-xin-apk:
	bash scripts/wait-eas-xin-apk.sh preview

xin-desktop:
	cd apps/xin-desktop && npm run dev

xin-icons:
	python3 scripts/generate-xinchat-icons.py
	cd apps/xin-desktop && node scripts/build-icon-ico.js

xin-redeploy:
	bash deploy/redeploy.sh --xin-web --skip-env-check

setup-xin:
	bash deploy/setup-xin-release.sh

sync-xin-installers:
	bash scripts/sync-xin-installers.sh

xin-desktop-dist-linux:
	cd apps/xin-desktop && npm ci && npm run check && npm run dist:linux

xin-desktop-dist-win-docker:
	cd apps/xin-desktop && npm run dist:win:docker

sync-xin-desktop-updates:
	bash scripts/sync-xin-desktop-updates.sh

publish-xin:
	bash scripts/publish-xin-release.sh

publish-xin-linux:
	bash scripts/publish-xin-release.sh --linux-dist

publish-xin-full:
	bash scripts/publish-xin-full.sh

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

smoke-xin:
	bash deploy/smoke-xin.sh

redeploy:
	bash deploy/redeploy.sh

soak:
	bash deploy/soak.sh

soak-multi:
	bash deploy/soak.sh --multi

test: test-api check-openapi smoke
	cd apps/web && npm run typecheck
	cd apps/xin-web && npm run typecheck
	cd apps/xin-mobile && npm run typecheck
