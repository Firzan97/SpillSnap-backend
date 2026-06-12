#!/usr/bin/env bash
# Pull latest, rebuild, restart. Run on the VPS as the deploy user:
#   cd /opt/spillsnap-backend && ./deploy/deploy.sh
set -euo pipefail

cd /opt/spillsnap-backend

# Tolerate the repo dir being owned by another user (e.g. provisioned as root).
# Without this, git aborts with "detected dubious ownership".
git config --global --add safe.directory /opt/spillsnap-backend 2>/dev/null || true

echo "→ Syncing to origin/main (source of truth; discards stray local edits)..."
git fetch origin main
git reset --hard origin/main
# Drop stray untracked files under src/ ONLY (e.g. source deleted in a refactor)
# so a stale .ts left on disk isn't compiled. Scoped to src/ because the app
# user's home IS this repo dir — ~/.ssh (deploy key) and ~/.pm2 sit untracked at
# the repo root, and an unscoped clean would delete them.
git clean -fd src/

echo "→ Installing deps (clean)..."
npm ci

echo "→ Building..."
npm run build

echo "→ Reloading PM2 process..."
# reload if already running, else start it the first time
pm2 reload spillsnap-api --update-env || pm2 start ecosystem.config.js
pm2 save
pm2 status spillsnap-api

echo "→ Health check..."
# Confirm the app actually serves (PM2 "online" alone doesn't catch a crash-loop).
PORT="${PORT:-3000}"
for i in $(seq 1 10); do
  if curl -fsS "http://localhost:${PORT}/api/v1/public/stats" >/dev/null 2>&1; then
    echo "✓ API healthy on :${PORT}"
    break
  fi
  if [ "$i" = "10" ]; then
    echo "✗ API not responding after deploy — check: pm2 logs spillsnap-api"
    exit 1
  fi
  sleep 2
done

echo "✓ Deployed. Tail logs with: pm2 logs spillsnap-api"
