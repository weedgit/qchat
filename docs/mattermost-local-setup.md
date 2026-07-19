# Run Mattermost Locally (Explore)

All Mattermost reference repos live under `/home/hitman/Desktop/chat-app/mattermost/`:

| Folder | What it is |
|---|---|
| `mattermost/source/` | Full server + webapp source (Go + React) |
| `mattermost/mobile/` | Official iOS/Android React Native app |
| `mattermost/desktop/` | Official Electron desktop app (Windows/Mac/Linux) |
| `mattermost/docker/` | Official Docker Compose deploy (easiest way to **see** it) |

## 1. Install Docker (one-time)

Run these in your own terminal (needs your password):

```bash
sudo pacman -S --noconfirm extra/docker extra/docker-compose
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Then **log out and back in** (or run `newgrp docker`) so the `docker` group takes effect.

Verify:

```bash
docker --version
docker compose version
```

## 2. Fix volume permissions

```bash
cd /home/hitman/Desktop/chat-app/mattermost/docker
sudo chown -R 2000:2000 ./volumes/app/mattermost
```

## 3. Start Mattermost

```bash
cd /home/hitman/Desktop/chat-app/mattermost/docker
docker compose -f docker-compose.yml -f docker-compose.without-nginx.yml up -d
```

First start pulls images (a few minutes). Then open:

**http://localhost:8065**

Create the first admin account in the browser, then explore channels, DMs, files, and System Console.

## 4. Useful commands

```bash
cd /home/hitman/Desktop/chat-app/mattermost/docker

# Status / logs
docker compose -f docker-compose.yml -f docker-compose.without-nginx.yml ps
docker compose -f docker-compose.yml -f docker-compose.without-nginx.yml logs -f mattermost

# Stop
docker compose -f docker-compose.yml -f docker-compose.without-nginx.yml down

# Stop and wipe data
docker compose -f docker-compose.yml -f docker-compose.without-nginx.yml down -v
```

## Notes

- Local config uses Team Edition, `DOMAIN=localhost`, timezone `Asia/Shanghai`, port `8065`.
- Source browsing: start in `mattermost/source/server` (backend) and `mattermost/source/webapp` (frontend).
- Desktop source: `mattermost/desktop/src/` (Electron main + renderer).
- Mobile app needs a reachable server URL (not just `localhost` from a physical phone) — use your LAN IP or a tunnel later.
