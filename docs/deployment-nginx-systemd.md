# Deploy Qchat with systemd and nginx

This setup exposes Qchat at `https://SERVER_IP/` (HTTP redirects to HTTPS):

- `systemd` runs the Go API continuously on `127.0.0.1:8080`.
- nginx serves the static web build on port **443** (self-signed TLS by default).
- nginx proxies `/v1/`, `/v1/ws`, and `/healthz` to the API.
- LiveKit signaling is proxied as **WSS** on port **7443** (required for calls on HTTPS pages).

Mic/camera require a secure context: open **HTTPS**, accept the self-signed warning once.
For a public domain, replace `deploy/certs/` with Let's Encrypt and keep the same nginx layout.

Run the commands below as `root`, or prefix system commands with `sudo`.

## Prerequisites

- Go installed at `/usr/local/go/bin/go`
- Node.js and npm
- Docker and Docker Compose
- systemd
- nginx

Install nginx on Ubuntu:

```bash
apt-get update
apt-get install -y nginx rsync
```

The checked-in deployment files use `/root/qchat` as the repository path. If
the repository is elsewhere, update the paths in:

- `deploy/qchat-api.service`
- `deploy/nginx-qchat.conf`

## 1. Start the infrastructure

LiveKit/coturn configs are generated per machine (no hardcoded IPs in git).
On each host (laptop, LAN VM, or VPS), render then start:

```bash
cd /root/qchat
# Auto-detect this machine's browser-reachable IP, or pass --host PUBLIC_IP
./deploy/render-media-config.sh
# optional override: ./deploy/render-media-config.sh --host 203.0.113.10

set -a && source deploy/generated/media.env && set +a
docker compose up -d postgres redis minio nats livekit coturn

# Or media only:
# ./deploy/up-media.sh
```

`deploy/generated/media.env` sets `LIVEKIT_URL` / `LIVEKIT_NODE_IP` for this host.
The API unit loads that file automatically (see `deploy/qchat-api.service`).

## 2. Configure the API

Edit `deploy/qchat-api.env` and set production values. At minimum, replace
`QCHAT_JWT_SECRET`.

```bash
chmod 600 /root/qchat/deploy/qchat-api.env
```

Do not commit real credentials.

## 3. Build and install the API daemon

```bash
cd /root/qchat/services/api
mkdir -p bin
/usr/local/go/bin/go build -o bin/qchat-api ./cmd/api

ln -sfn /root/qchat/deploy/qchat-api.service \
  /etc/systemd/system/qchat-api.service
systemctl daemon-reload
systemctl enable --now qchat-api
```

Verify the daemon:

```bash
systemctl status qchat-api
curl http://127.0.0.1:8080/healthz
```

Useful daemon commands:

```bash
systemctl restart qchat-api
systemctl stop qchat-api
journalctl -u qchat-api -f
```

The unit uses `Restart=always`, so the API restarts after failures and starts
automatically after a reboot.

## 4. Build the frontend

Build with an empty API URL so browser requests use the same nginx origin:

```bash
cd /root/qchat/apps/web
npm ci
NEXT_PUBLIC_API_URL="" npm run build
```

The static site is generated in `apps/web/out/`.

## 5. Enable the nginx site

```bash
ln -sfn /root/qchat/deploy/nginx-qchat.conf \
  /etc/nginx/sites-available/qchat.conf
ln -sfn /etc/nginx/sites-available/qchat.conf \
  /etc/nginx/sites-enabled/qchat.conf
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl enable --now nginx
systemctl reload nginx
```

The supplied nginx configuration:

- serves `apps/web/out/` at `/`;
- proxies REST requests under `/v1/`;
- supports WebSocket upgrades at `/v1/ws`;
- proxies `/healthz`;
- accepts uploads up to 50 MB.

The current static root is below `/root`, so the nginx worker must be able to
traverse that directory. For a production installation, prefer copying the
build to `/var/www/qchat` and changing the `root` directive instead of running
nginx workers as `root`:

```bash
mkdir -p /var/www/qchat
rsync -a --delete /root/qchat/apps/web/out/ /var/www/qchat/
chown -R www-data:www-data /var/www/qchat
```

Then set `root /var/www/qchat;` in `deploy/nginx-qchat.conf`, keep
`user www-data;` in `/etc/nginx/nginx.conf`, test, and reload nginx.

## 6. Verify port 80

```bash
curl -I http://127.0.0.1/
curl http://127.0.0.1/healthz
```

Open `http://SERVER_IP/` in a browser. Ensure inbound TCP port 80 is allowed by
the host firewall and cloud firewall/security group.

## Deploy updates

Use the redeploy script (always runs `git pull` first):

```bash
cd /root/qchat

# Pull + rebuild API and web, restart systemd, reload nginx
./deploy/redeploy.sh

# Pull + API only / web only
./deploy/redeploy.sh --api
./deploy/redeploy.sh --web
```

If nginx serves from `/var/www/qchat` instead of `apps/web/out`:

```bash
QCHAT_WEB_ROOT=/var/www/qchat ./deploy/redeploy.sh --web
```

Manual steps (equivalent to the script):

```bash
# API
cd /root/qchat/services/api
/usr/local/go/bin/go build -o bin/qchat-api ./cmd/api
systemctl restart qchat-api

# Web
cd /root/qchat/apps/web
NEXT_PUBLIC_API_URL="" npm run build
# Only needed when nginx serves /var/www/qchat:
# rsync -a --delete out/ /var/www/qchat/
nginx -t && systemctl reload nginx
```

## Troubleshooting

```bash
# API status and logs
systemctl status qchat-api
journalctl -u qchat-api -n 100 --no-pager

# nginx status, syntax, and logs
systemctl status nginx
nginx -t
journalctl -u nginx -n 100 --no-pager

# Listening ports (API, web, LiveKit signal, LiveKit WSS via nginx, TURN)
ss -ltnp | grep -E ':80|:443|:8080|:7880|:7443|:3478'
```

- `502 Bad Gateway`: confirm `qchat-api` is running on port 8080.
- `403 Forbidden`: confirm the nginx worker can read and traverse the static
  build path.
- WebSocket disconnects: confirm `/v1/ws` retains the nginx upgrade headers.
- Calls fail / no media: confirm LiveKit (`:7880`) and WSS proxy (`:7443`), then:
  `./deploy/check-env.sh` and `./deploy/smoke-livekit.sh`.
- Port already in use: stop any manually started `go run ./cmd/api` process.

## Env / media guards

Before shipping production:

```bash
# Refuses weak JWT / SMS / LiveKit defaults when QCHAT_ENV=production
./deploy/check-env.sh
# or always fail on weak secrets:
./deploy/check-env.sh --strict

# Render refuses default LiveKit/TURN secrets when QCHAT_ENV=production
LIVEKIT_API_KEY=… LIVEKIT_API_SECRET=… TURN_PASS=… ./deploy/render-media-config.sh

# Redeploy with LiveKit health required
./deploy/redeploy.sh --require-media
```

The API also refuses default LiveKit keys at startup when `QCHAT_ENV=production`.

## Desktop update feed

nginx serves electron-builder generic artifacts at `/desktop-updates/`
(`deploy/nginx-qchat.conf` → alias `/var/www/qchat-desktop-updates/`).

```bash
sudo mkdir -p /var/www/qchat-desktop-updates
# After npm run dist:linux / dist:win[:docker], copy latest*.yml + installers:
#   sudo rsync -a apps/desktop/dist/latest*.yml \
#     apps/desktop/dist/qchat-desktop*.{AppImage,deb,exe} \
#     /var/www/qchat-desktop-updates/
sudo nginx -t && sudo systemctl reload nginx
```

Point packaged clients at the feed (leave `production.json` `updateUrl` empty
until this is ready):

```bash
# example — set in userData/config.json or rebuild with production.json:
# "updateUrl": "https://YOUR_HOST/desktop-updates"
```

Local desktop scaffold checks: `make desktop-check`. Wine Windows build on Linux:
`make desktop-dist-win-docker` (requires Docker).
