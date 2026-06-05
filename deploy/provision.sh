#!/usr/bin/env bash
# One-time VPS provisioning for the SpendSnap backend.
# Run ONCE on a fresh server as root:  sudo bash deploy/provision.sh
# (or pipe it in before the repo exists — see DEPLOY.md).
#
# Idempotent: safe to re-run. Installs Node + git + PM2, creates the service
# user, prepares dirs/keys, then clones + builds + starts the app.
#
# NOTE: this is provisioning, not deployment. Routine redeploys use
# deploy/deploy.sh (git pull -> build -> pm2 reload), which the GitHub Action runs.
set -euo pipefail

APP_USER=spendsnap
APP_DIR=/opt/spendsnap-backend
REPO_URL=git@github.com:Firzan97/SpendSnap-backend.git
NODE_MAJOR=20

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/provision.sh" >&2
  exit 1
fi

echo "→ apt update + base packages..."
apt-get update -y
apt-get install -y curl git ca-certificates

echo "→ Node ${NODE_MAJOR} (NodeSource)..."
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v${NODE_MAJOR}.* ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
echo "  node $(node -v), npm $(npm -v)"

echo "→ PM2 (global)..."
command -v pm2 >/dev/null 2>&1 || npm install -g pm2

echo "→ Service user '${APP_USER}'..."
if ! id "${APP_USER}" >/dev/null 2>&1; then
  adduser --system --group --home "${APP_DIR}" "${APP_USER}"
fi

echo "→ SSH dir + deploy key..."
install -d -m 700 -o "${APP_USER}" -g "${APP_USER}" "${APP_DIR}/.ssh"
if [[ ! -f "${APP_DIR}/.ssh/id_ed25519" ]]; then
  sudo -u "${APP_USER}" ssh-keygen -t ed25519 -f "${APP_DIR}/.ssh/id_ed25519" -N ""
fi
# Trust github.com so non-interactive git doesn't hit the yes/no prompt.
sudo -u "${APP_USER}" bash -c "ssh-keyscan github.com >> ${APP_DIR}/.ssh/known_hosts 2>/dev/null; sort -u -o ${APP_DIR}/.ssh/known_hosts ${APP_DIR}/.ssh/known_hosts"

echo
echo "  ── DEPLOY KEY ──────────────────────────────────────────────"
cat "${APP_DIR}/.ssh/id_ed25519.pub"
echo "  ────────────────────────────────────────────────────────────"
echo "  Add the line above to GitHub: repo → Settings → Deploy keys → Add"
echo "  (read-only). Then re-run this script to finish clone + build."
echo

# Verify the deploy key is authorized before trying to pull.
if ! sudo -u "${APP_USER}" ssh -T -o StrictHostKeyChecking=accept-new git@github.com 2>&1 | grep -q "successfully authenticated"; then
  echo "✗ GitHub deploy key not authorized yet. Add the key above, then re-run." >&2
  exit 1
fi

echo "→ Fetching repo into ${APP_DIR}..."
if [[ ! -d "${APP_DIR}/.git" ]]; then
  # Dir already exists (it's the user's home), so init-in-place instead of clone.
  sudo -u "${APP_USER}" git -C "${APP_DIR}" init -b main
  sudo -u "${APP_USER}" git -C "${APP_DIR}" remote add origin "${REPO_URL}"
fi
sudo -u "${APP_USER}" git -C "${APP_DIR}" fetch origin main
sudo -u "${APP_USER}" git -C "${APP_DIR}" checkout -f -t origin/main 2>/dev/null \
  || sudo -u "${APP_USER}" git -C "${APP_DIR}" reset --hard origin/main

echo "→ Install + build..."
sudo -u "${APP_USER}" bash -c "cd ${APP_DIR} && npm ci && npm run build"

if [[ ! -f "${APP_DIR}/.env" ]]; then
  echo
  echo "⚠  ${APP_DIR}/.env is MISSING. Create it (prod values, NODE_ENV=production)"
  echo "   then run:  sudo -u ${APP_USER} pm2 start ${APP_DIR}/ecosystem.config.js && sudo -u ${APP_USER} pm2 save"
  echo "   See DEPLOY.md §1.3 for the variable list."
  exit 0
fi

echo "→ Start under PM2..."
sudo -u "${APP_USER}" bash -c "cd ${APP_DIR} && pm2 start ecosystem.config.js && pm2 save"

echo "→ Enable PM2 on boot..."
pm2_startup_cmd=$(sudo -u "${APP_USER}" pm2 startup systemd -u "${APP_USER}" --hp "${APP_DIR}" | grep '^sudo env' || true)
[[ -n "${pm2_startup_cmd}" ]] && eval "${pm2_startup_cmd}"
sudo -u "${APP_USER}" pm2 save

echo
echo "✓ Provisioned. App under PM2. Routine deploys now via deploy/deploy.sh (CI)."
echo "  Logs: sudo -u ${APP_USER} pm2 logs spendsnap-api"
