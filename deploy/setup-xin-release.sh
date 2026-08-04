#!/usr/bin/env bash
# One-time / occasional host prep for XinChat releases on the same VPS as Rchat.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
log() { printf '\n==> %s\n' "$*"; }

log "create desktop update directories"
sudo mkdir -p /var/www/xin-desktop-updates
sudo mkdir -p /var/www/qchat-desktop-updates
sudo chown -R "$(whoami):$(whoami)" /var/www/xin-desktop-updates 2>/dev/null || true

log "nginx config test"
if command -v nginx >/dev/null 2>&1; then
  sudo nginx -t
  echo "nginx OK — reload with: sudo systemctl reload nginx"
else
  echo "warning: nginx not installed"
fi

if [[ -f "$ROOT/deploy/nginx-xinchat-subdomain.conf.example" ]]; then
  echo ""
  echo "Optional subdomain: include deploy/nginx-xinchat-subdomain.conf.example in nginx"
  echo "  (after DNS xin.yourdomain.com → this host)"
fi

echo ""
echo "Publish XinChat installers:"
echo "  ./scripts/sync-xin-installers.sh"
echo "  ./deploy/redeploy.sh --xin-web --sync-xin-installers --skip-env-check"
echo ""
echo "Desktop auto-update feed:"
echo "  ./scripts/sync-xin-desktop-updates.sh"
echo "  https://<host>/xin-desktop-updates/"
