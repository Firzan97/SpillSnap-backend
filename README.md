# SpillSnap Backend

API for **SpillSnap** — receipt scanning, LHDN tax tagging, and spend analytics for Malaysia. Built with [NestJS 11](https://nestjs.com/) + TypeScript, PostgreSQL (Supabase), and Claude vision for OCR.

Powers the SpillSnap mobile app (Expo) and the marketing/landing web app (Nuxt). Authentication is owned by **Clerk** — this backend only verifies the Clerk session token and mirrors the user into its local `users` table.

## Stack

| Concern        | Choice |
|----------------|--------|
| Framework      | NestJS 11 (Express platform) |
| Language       | TypeScript 5.7 |
| Database       | PostgreSQL via TypeORM 0.3 (Supabase-hosted) |
| Auth           | Clerk (login/SSO) + Clerk session-token verification (`passport` strategy) |
| Receipt OCR    | Claude vision (`@anthropic-ai/sdk`) — Haiku, escalating to Sonnet when unsure |
| Billing        | Stripe (web-sold Pro subscription, auto-renewing) |
| File storage   | Supabase Storage (private `receipts` bucket, public `avatars` bucket) |
| Push           | Expo Server SDK |
| WhatsApp       | Meta Cloud API (Pro receipt capture — inert until configured) |
| Cache          | ioredis (optional; public-stats cache) |
| API docs       | Swagger (non-production only) |

## Features

The app is organized into feature modules under `src/`:

- **auth** — verify Clerk session token, mirror/sync user (Clerk owns login/SSO); fires a one-time WhatsApp onboarding ping on first signup / first phone save
- **receipts** — capture (Claude OCR extract), save, list, edit, delete; detects **incomplete** captures (cut-off receipts) and **multiple distinct receipts**, surfaced as `complete` / `multipleReceipts` + a `warning` prompt
- **analytics** — spend analytics endpoints (trends, breakdowns)
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
- **whatsapp** — Pro receipt upload via WhatsApp (Meta Cloud API); auto-detects incomplete captures (asks for the rest) and multiple receipts (asks to send one at a time)

## Prerequisites

- **Node.js 20+** (production runs on Node 20)
- **PostgreSQL** — a Supabase project (or local Postgres)
- **Clerk** application (auth) — provides `CLERK_SECRET_KEY` + issuer
- **Supabase** project (Storage; DB hosting)
- **Anthropic API key** (receipt OCR)
- **Stripe** account (billing) — optional for local dev
- **Meta WhatsApp** app (optional) — Pro WhatsApp upload

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
- **Auth (Clerk)** — `CLERK_SECRET_KEY`, `CLERK_ISSUER` (Google SSO etc. configured in the Clerk dashboard, not here). App boots crash if these are missing in production.
- **Storage (Supabase)** — `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STORAGE_BUCKET` (private receipts), `AVATAR_BUCKET` (public avatars)
- **Receipt OCR** — `ANTHROPIC_API_KEY`
- **Billing** — `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_ANNUAL`
- **App** — `PORT`, `NODE_ENV`, `FRONTEND_URL` (comma-separated list for CORS / Stripe redirect URLs)
- **WhatsApp** — `WHATSAPP_*` (inert until phone-number ID + access token are set); `WHATSAPP_WELCOME_TEMPLATE` is reused for both the Pro-welcome and the first-signup onboarding ping

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
- `005-supabase-id-to-clerk-id.sql` — rename `supabase_id` → `clerk_id` (varchar) for the Clerk migration
- `006-receipts-user-fk-cascade.sql` — convert `receipts.user_id` to uuid + add `ON DELETE CASCADE`
- `007-users-country.sql` — add `users.country` (drives the Malaysia leaderboard scope)
- `008-users-wa-onboarded-at.sql` — add `users.wa_onboarded_at` (one-time WhatsApp onboarding flag)

> ⚠️ Apply migrations **before** deploying code that depends on the new schema — prod runs with `synchronize` off, so the app will error on a missing column otherwise.

## Production notes

Set **`NODE_ENV=production`** in prod — this disables Swagger and TypeORM `synchronize`, and enables Postgres SSL. `FRONTEND_URL` accepts a comma-separated origin list (apex, www, app subdomain).

The Stripe webhook needs the **raw request body** (the app is created with `rawBody: true`) to verify signatures — keep that intact behind any proxy.

Deployment (Exabytes VPS + Caddy + systemd) is documented in [`deploy/DEPLOY.md`](deploy/DEPLOY.md), with `deploy/Caddyfile`, `deploy/spillsnap-api.service`, and `deploy/deploy.sh`.

## License

UNLICENSED — private project.
