-- Admin dashboard tracking: distinguish where a receipt was captured, and
-- persist per-call AI token usage/cost so the admin dashboard can report
-- token consumption, AI cost per receipt, and the model-escalation rate.
--
-- Idempotent + transactional: safe to run once on prod. Dev/staging on TypeORM
-- synchronize already has these.
--
-- Run: psql "$DATABASE_URL" -f migrations/008-admin-tracking.sql

BEGIN;

-- ── Receipt capture channel ──────────────────────────────────────────────────
-- Existing rows predate the column; default 'app' is the correct backfill since
-- WhatsApp ingestion (captureAndSave) is the only other channel and is newer.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'receipts_source_enum') THEN
    CREATE TYPE receipts_source_enum AS ENUM ('app', 'whatsapp');
  END IF;
END$$;

ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS source receipts_source_enum NOT NULL DEFAULT 'app';

-- ── AI usage ledger ──────────────────────────────────────────────────────────
-- One row per Anthropic extraction call. user_id is nullable so usage from
-- system/backfill jobs (no user) is still captured. cost_usd is computed at
-- write time from the model's published per-MTok rates (see ai-usage.service).
CREATE TABLE IF NOT EXISTS ai_usage (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid REFERENCES users(id) ON DELETE SET NULL,
  channel               receipts_source_enum NOT NULL DEFAULT 'app',
  model                 varchar NOT NULL,
  input_tokens          integer NOT NULL DEFAULT 0,
  output_tokens         integer NOT NULL DEFAULT 0,
  cache_read_tokens     integer NOT NULL DEFAULT 0,
  cache_creation_tokens integer NOT NULL DEFAULT 0,
  cost_usd              numeric(12, 6) NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_created_at ON ai_usage (created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_id ON ai_usage (user_id);

COMMIT;
