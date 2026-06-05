#!/usr/bin/env bash
# Pull latest, rebuild, restart. Run on the VPS as the deploy user:
#   cd /opt/spendsnap-backend && ./deploy/deploy.sh
set -euo pipefail

cd /opt/spendsnap-backend

# Tolerate the repo dir being owned by another user (e.g. provisioned as root).
# Without this, git aborts with "detected dubious ownership".
git config --global --add safe.directory /opt/spendsnap-backend 2>/dev/null || true

echo "→ Pulling latest..."
git pull origin main

echo "→ Installing deps (clean)..."
npm ci

echo "→ Building..."
npm run build

echo "→ Reloading PM2 process..."
# reload if already running, else start it the first time
pm2 reload spendsnap-api --update-env || pm2 start ecosystem.config.js
pm2 save
pm2 status spendsnap-api

echo "✓ Deployed. Tail logs with: pm2 logs spendsnap-api"
