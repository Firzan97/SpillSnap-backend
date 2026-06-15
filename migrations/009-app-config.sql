-- Editable runtime settings (admin-managed pricing, tax-relief policy, …).
-- One row per key; value holds the full JSON payload. Services read with a
-- code-level fallback, so an empty table behaves exactly like the old hardcoded
-- config. Idempotent + transactional.
--
-- Run: psql "$DATABASE_URL" -f migrations/009-app-config.sql

BEGIN;

CREATE TABLE IF NOT EXISTS app_config (
  key        varchar PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
