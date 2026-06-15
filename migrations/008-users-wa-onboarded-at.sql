-- Adds users.wa_onboarded_at — the timestamp of the one-time WhatsApp onboarding
-- ping. Used to make the ping idempotent: sent once on first signup (or when the
-- user first saves a phone), never re-sent when they edit the number later.
-- Idempotent + transactional: safe to run once on prod. Dev/staging on TypeORM
-- synchronize already has the column.
--
-- Run: psql "$DATABASE_URL" -f migrations/008-users-wa-onboarded-at.sql

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS wa_onboarded_at timestamptz;

COMMIT;
