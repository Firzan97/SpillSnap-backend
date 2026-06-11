# SpillSnap Backend

API for **SpillSnap** — receipt scanning, LHDN tax tagging, and spend analytics for Malaysia. Built with [NestJS 11](https://nestjs.com/) + TypeScript, PostgreSQL (Supabase), and Claude vision for OCR.

Powers the SpillSnap mobile app (Expo) and the marketing/landing web app (Nuxt). Authentication is owned by **Supabase Auth** — this backend only verifies the access token Supabase issues and syncs the user.

## Stack

| Concern        | Choice |
|----------------|--------|
| Framework      | NestJS 11 (Express platform) |
| Language       | TypeScript 5.7 |
| Database       | PostgreSQL via TypeORM 0.3 (Supabase-hosted) |
| Auth           | Supabase Auth (login/SSO) + `passport-jwt` token verification |
| Receipt OCR    | Claude vision (`@anthropic-ai/sdk`) |
| Billing        | Stripe (web-sold Pro subscription, auto-renewing) |
| File storage   | Supabase Storage (private `receipts` bucket, public `avatars` bucket) |
| Push           | Expo Server SDK |
| WhatsApp       | Meta Cloud API (Pro receipt capture — inert until configured) |
| Cache          | ioredis (optional; public-stats cache) |
| API docs       | Swagger (non-production only) |

## Features

The app is organized into feature modules under `src/`:

- **auth** — verify Supabase token, sync user (Supabase owns login/SSO)
- **receipts** — capture (Claude OCR extract), save, list, edit, delete
- **dashboard** — home dashboard aggregation
- **tax** — LHDN relief tagging, manual reliefs, YA relief rules
- **export** — CSV export for LHDN e-Filing
- **billing** — Stripe checkout + customer portal, entitlement, daily-usage throttle
- **settings** — server-driven settings screens, categories, tags, notification prefs
- **leaderboard** — receipt-upload leaderboard (podium, rankings, standing)
- **notifications** / **push** — in-app feed + Expo push tokens
- **filter-presets** — saved receipt filters
- **currency** — multi-currency support (Pro)
- **feedback** — testimonials store
- **public-stats** — unauthenticated landing-page stats + approved testimonials (server-cached hourly)
- **whatsapp** — Pro receipt upload via WhatsApp (Meta Cloud API)

## Prerequisites

- **Node.js 20+** (production runs on Node 20)
- **PostgreSQL** — a Supabase project (or local Postgres)
- **Supabase** project (Auth + Storage)
- **Anthropic API key** (receipt OCR)
- **Stripe** account (billing) — optional for local dev

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# then fill in the values (see Environment below)

# 3. Run
npm run start:dev
```

API boots at **`http://localhost:3000/api/v1`** (binds `0.0.0.0` so physical devices on the LAN can reach it at the machine's IP).

Swagger docs (non-production only): **`http://localhost:3000/docs`**

## Environment

All variables are documented in [`.env.example`](.env.example). Key groups:

- **Database** — `DATABASE_URL` or discrete `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASS`/`DB_NAME`
- **Supabase Auth** — `SUPABASE_URL`, `SUPABASE_JWT_SECRET`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (Google/Apple SSO is configured in the Supabase dashboard, not here)
- **Storage** — `STORAGE_BUCKET` (private receipts), `AVATAR_BUCKET` (public avatars)
- **Receipt OCR** — `ANTHROPIC_API_KEY`
- **Billing** — `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_ANNUAL`
- **App** — `PORT`, `NODE_ENV`, `FRONTEND_URL` (comma-separated list for CORS / Stripe redirect URLs)
- **WhatsApp** — `WHATSAPP_*` (inert until phone-number ID + access token are set)

> `.env` is gitignored — never commit it. Only `.env.example` is tracked.

## Scripts

```bash
npm run start:dev    # watch mode
npm run start:prod   # node dist/main (after npm run build)
npm run build        # nest build → dist/
npm run lint         # eslint --fix
npm run format       # prettier
npm run test         # unit tests (jest)
npm run test:e2e     # e2e tests
npm run test:cov     # coverage
```

## Database & migrations

Schema is managed by TypeORM. `synchronize` is **on in dev, off in production** (`NODE_ENV=production`). Production schema changes are applied via the raw SQL files in [`migrations/`](migrations/), run in order:

- `001-remove-apple-auth-provider.sql`
- `002-receipt-image-paths.sql`
- `003-lhdn-relief-add-childcare-education.sql`
- `004-receipt-relief-provenance.sql`

## Production notes

Set **`NODE_ENV=production`** in prod — this disables Swagger and TypeORM `synchronize`, and enables Postgres SSL. `FRONTEND_URL` accepts a comma-separated origin list (apex, www, app subdomain).

The Stripe webhook needs the **raw request body** (the app is created with `rawBody: true`) to verify signatures — keep that intact behind any proxy.

Deployment (Exabytes VPS + Caddy + systemd) is documented in [`deploy/DEPLOY.md`](deploy/DEPLOY.md), with `deploy/Caddyfile`, `deploy/spillsnap-api.service`, and `deploy/deploy.sh`.

## License

UNLICENSED — private project.
