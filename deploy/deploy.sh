#!/usr/bin/env bash
# Pull latest, rebuild, restart. Run on the VPS as the deploy user:
#   cd /opt/spendsnap-backend && ./deploy/deploy.sh
set -euo pipefail

cd /opt/spendsnap-backend

echo "→ Pulling latest..."
git pull origin main

echo "→ Installing deps (clean)..."
npm ci

echo "→ Building..."
npm run build

echo "→ Restarting service..."
sudo systemctl restart spendsnap-api
sleep 2
sudo systemctl status spendsnap-api --no-pager -l | head -n 12

echo "✓ Deployed. Tail logs with: journalctl -u spendsnap-api -f"
