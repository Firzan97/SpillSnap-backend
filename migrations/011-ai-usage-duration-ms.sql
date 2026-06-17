-- Adds ai_usage.duration_ms — wall-clock processing time (ms) of each receipt
-- scan/extraction call, for the admin dashboard + scan-performance tracking.
-- Idempotent + transactional: safe to run once on prod. Dev/staging on TypeORM
-- synchronize already has the column.
--
-- Run: psql "$DATABASE_URL" -f migrations/011-ai-usage-duration-ms.sql

BEGIN;

ALTER TABLE ai_usage
  ADD COLUMN IF NOT EXISTS duration_ms integer;

COMMIT;
