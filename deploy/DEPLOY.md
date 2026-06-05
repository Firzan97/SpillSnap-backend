# SpendSnap — Deploy Guide

Architecture:

```
Landing (Nuxt)  →  Cloudflare Pages      (free, global CDN)   spendsnap.my
Backend (Nest)  →  Exabytes NVMe C2 VPS  (Caddy + systemd)    api.spendsnap.my
DB/Auth/Storage →  Supabase              (already)
```

Swap the example domains/paths below for your own. Assumed domains:
- `spendsnap.my` (+ `www`) → landing
- `api.spendsnap.my` → backend
- `app.spendsnap.my` → the product app (separate; not covered here)

---

## Part 0 — DNS (do this first, on Cloudflare)

1. Add `spendsnap.my` to a **free Cloudflare account** and point your registrar's
   nameservers at the two Cloudflare gives you.
2. Records:
   | Type | Name | Value | Proxy |
   |------|------|-------|-------|
   | A | `api` | `<VPS_IP>` | **DNS only** (grey cloud) |
   | CNAME | `@` / `www` | (set automatically when you add the Pages custom domain) | Proxied |

   > `api` must be **DNS only** so Caddy can get its own Let's Encrypt cert and so
   > the API isn't subject to Cloudflare's proxy quirks. The landing is proxied.

---

## Part 1 — Backend on the Exabytes C2 VPS

SSH in as root (Exabytes emails you the IP + password): `ssh root@<VPS_IP>`

### 1.1 Base setup + firewall
```bash
apt update && apt upgrade -y
# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs git
# Firewall: only SSH + HTTP + HTTPS
apt install -y ufw
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable
# A non-root user to run the app
adduser --system --group --home /opt/spendsnap-backend spendsnap
```

### 1.2 Get the code
```bash
cd /opt
git clone <YOUR_BACKEND_REPO_URL> spendsnap-backend
chown -R spendsnap:spendsnap /opt/spendsnap-backend
cd spendsnap-backend
npm ci
npm run build      # outputs dist/main.js
```

### 1.3 Production env file
Create `/opt/spendsnap-backend/.env` (chmod 600). **Set NODE_ENV=production** so
TypeORM does NOT auto-synchronize the schema.
```bash
NODE_ENV=production
PORT=3000

# Database — Supabase. Use the POOLER connection string (port 6543) for serverless;
# direct (5432) is fine for a single long-lived VPS process.
DATABASE_URL=postgresql://postgres:<PW>@db.<ref>.supabase.co:5432/postgres

# Supabase Auth (bare project root — JWKS verification)
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...        # if used by storage/admin

ANTHROPIC_API_KEY=sk-ant-...

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# CORS — comma-separated; must include every web origin that calls the API
FRONTEND_URL=https://spendsnap.my,https://www.spendsnap.my,https://app.spendsnap.my

APP_VERSION=1.0.0
PUBLIC_STATS_TTL_MS=3600000
```
```bash
chmod 600 /opt/spendsnap-backend/.env
chown spendsnap:spendsnap /opt/spendsnap-backend/.env
```

> Schema note: you've been running dev with `synchronize:true` against this same
> Supabase DB, so the tables already exist. In production keep `NODE_ENV=production`
> and apply future schema changes with SQL migrations (see `migrations/`), not
> synchronize.

### 1.4 Run it as a service
```bash
cp deploy/spendsnap-api.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now spendsnap-api
systemctl status spendsnap-api --no-pager      # should be active (running)
journalctl -u spendsnap-api -f                 # live logs
```
The app now listens on `127.0.0.1:3000` (not public yet).

### 1.5 HTTPS reverse proxy (Caddy)
```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

mkdir -p /var/log/caddy
cp /opt/spendsnap-backend/deploy/Caddyfile /etc/caddy/Caddyfile
# edit the domain inside if not api.spendsnap.my
systemctl reload caddy
```
Caddy auto-fetches a Let's Encrypt cert for `api.spendsnap.my` (needs the DNS A
record from Part 0 + ports 80/443 open). Verify:
```bash
curl https://api.spendsnap.my/api/v1/public/stats
```

### 1.6 Redeploys later
```bash
cd /opt/spendsnap-backend && ./deploy/deploy.sh
```

---

## Part 2 — Landing on Cloudflare Pages

1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** →
   pick the `spendsnap-web` repo.
2. Build settings (framework preset **Nuxt**):
   - Build command: `npm run build`
   - Build output directory: `dist`
   - (Cloudflare auto-applies the `cloudflare-pages` Nitro preset.)
3. **Environment variables** (Production) — these feed `nuxt.config.ts` runtimeConfig:
   ```
   NUXT_PUBLIC_API_BASE=https://api.spendsnap.my
   NUXT_PUBLIC_APP_URL=https://app.spendsnap.my
   NUXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
   NUXT_PUBLIC_SUPABASE_ANON_KEY=...
   NUXT_PUBLIC_APP_STORE_URL=...        # optional
   NUXT_PUBLIC_PLAY_STORE_URL=...       # optional
   ```
   > `apiBase` is the ROOT only — the web code appends `/api/v1` itself. Do NOT
   > include `/api/v1` here.
4. Deploy. Then **Custom domains** → add `spendsnap.my` and `www.spendsnap.my`
   (Cloudflare wires the DNS for you since the zone is on Cloudflare).

---

## Part 3 — Verify end-to-end
- `https://api.spendsnap.my/api/v1/public/stats` returns JSON (backend + TLS OK).
- `https://spendsnap.my` loads, and the stats band / testimonials populate
  (landing → backend CORS OK). If they're empty with a CORS error in the browser
  console, fix `FRONTEND_URL` on the VPS and `systemctl restart spendsnap-api`.
- Swagger `/docs` is intentionally **off** in production (`NODE_ENV=production`).
- Stripe: point the live webhook at `https://api.spendsnap.my/api/v1/webhooks/stripe`
  and confirm `STRIPE_WEBHOOK_SECRET` matches.

## Notes
- Supabase region should be **Singapore (ap-southeast-1)** for lowest API latency
  from a MY VPS — every request round-trips to the DB.
- Back up nothing locally on the box — receipts/images live in Supabase Storage,
  data in Supabase Postgres. The VPS is stateless and disposable.
- A Dockerfile is included at the repo root if you later move to a container host
  (Cloud Run / App Runner) — the only refactor there is moving the in-memory
  public-stats cache to Redis.
