-- Adds users.country (ISO 3166-1 alpha-2) to power the "Malaysia" leaderboard
-- scope. The app is Malaysia-first, so existing rows + new rows default to 'MY'.
-- Idempotent + transactional: safe to run once on prod. Dev/staging on TypeORM
-- synchronize already has the column.
--
-- Run: psql "$DATABASE_URL" -f migrations/007-users-country.sql

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS country varchar(2) NOT NULL DEFAULT 'MY';

COMMIT;
