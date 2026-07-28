# Deployment modes

Qchat supports two production-style layouts. Pick one host for the **API + web**;
desktop clients only need the **web URL**.

| | **A — VPS** | **B — Local computer / LAN** (no VPS) |
|---|---|---|
| Typical host | Public VPS (`135.181.224.36`) | Home/office PC or LAN VM (`192.168.1.124`) |
| How users reach it | Public IP / domain | Same Wi‑Fi / LAN IP |
| Reverse proxy | **nginx** on 80/443 (recommended) | Optional; bare ports also work |
| Web URL | `https://SERVER_IP/` | `http://LAN_IP:3000` or `https://LAN_IP/` |
| API | Same origin via nginx, or `:8080` | `:8080` (Next on `:3000` → API auto `:8080`) |
| Desktop script | `npm run start:vps` / `start:server` | `npm run start:lan-host` / `start:ubuntu` |
| TLS / mic-camera | HTTPS (self-signed OK) | Prefer HTTPS+nginx; plain HTTP works for chat (UUID polyfill) |

Both modes use the same codebase. Infra (Postgres, Redis, MinIO, NATS, LiveKit)
is always started with Docker on that host.

---

## Method A — VPS (nginx + HTTPS)

Full guide: [`deployment-nginx-systemd.md`](./deployment-nginx-systemd.md).

Summary:

```bash
cd /root/qchat
./deploy/render-media-config.sh --host YOUR_PUBLIC_IP
set -a && source deploy/generated/media.env && set +a
docker compose up -d

# API via systemd + web static build + nginx (see full doc)
./deploy/redeploy.sh

# Optional: fail the deploy if LiveKit/coturn are unhealthy
./deploy/redeploy.sh --require-media

# Preflight only (production fails on weak JWT / SMS / LiveKit defaults)
./deploy/check-env.sh
```

Desktop (Windows / any client):

```powershell
cd apps/desktop
npm run start:vps
# same as: npm run start:server
# → https://135.181.224.36
```

Packaged installers read `apps/desktop/production.json` (`webUrl`).

---

## Method B — Local computer (no VPS)

Use when you only have a LAN machine (Ubuntu desktop/VM, Windows PC with Docker, etc.).

### B1 — Dev-style ports (fastest)

On the LAN host:

```bash
cd /path/to/qchat
./deploy/render-media-config.sh          # or: --host 192.168.1.124
set -a && source deploy/generated/media.env && set +a
docker compose up -d postgres redis minio nats livekit coturn

# API
cd services/api && go run ./cmd/api
# listens on :8080

# Web (separate terminal)
cd apps/web && npm ci && npm run dev
# listens on :3000 — leave NEXT_PUBLIC_API_URL unset → browser uses host:8080
```

Open firewall on the host if needed:

```bash
# Ubuntu example
sudo ufw allow 3000/tcp
sudo ufw allow 8080/tcp
sudo ufw allow 7880/tcp
# or: ./deploy/ufw-allow-qchat.sh
```

Desktop client on another PC:

```powershell
cd apps/desktop
# Edit package.json start:lan-host / start:ubuntu URL to your LAN IP, or:
npm start -- --url=http://192.168.1.124:3000
# or:
npm run start:lan-host
```

Captcha / token refresh in Electron resolve API as `http://LAN_IP:8080` when
the web URL port is `3000`.

### B2 — Same as VPS, but on LAN (nginx)

If you want one URL without `:3000`:

1. Follow [`deployment-nginx-systemd.md`](./deployment-nginx-systemd.md) on the LAN host.
2. Pass the LAN IP to media config: `./deploy/render-media-config.sh --host 192.168.1.124`
3. Point desktop at `http://192.168.1.124` or `https://192.168.1.124`

---

## Desktop URL cheat sheet

| Goal | Command |
|---|---|
| This machine’s Next.js | `npm run start:local` → `http://localhost:3000` |
| LAN host (Ubuntu VM) | `npm run start:lan-host` / `start:ubuntu` → `http://192.168.1.124:3000` |
| Public VPS | `npm run start:vps` / `start:server` → `https://135.181.224.36` |
| Custom | `npm start -- --url=https://YOUR_HOST` or `QCHAT_WEB_URL=...` |

Optional override for main-process API fetches:

```bash
QCHAT_API_URL=http://192.168.1.124:8080
```

---

## Choosing a mode

- **Have a VPS / public IP** → Method A (nginx + HTTPS). Best for phones, remote users, calls (secure context).
- **No VPS, only LAN** → Method B1 for development; B2 when you want a stable LAN URL for several desktops.
- You can run **both** hosts at once (VPS + home Ubuntu); each desktop session picks one URL. Sessions/tokens are per host.
