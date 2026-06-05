-- Track where a receipt's relief tag came from (user / ocr / backfill) and the
-- AI confidence for back-filled tags, so the relief back-fill never overwrites
-- a user-set tag and low-confidence guesses can be surfaced for review.
-- Nullable + IF NOT EXISTS = safe, idempotent. Dev on TypeORM synchronize
-- already applied this.
--
-- Run: psql "$DATABASE_URL" -f migrations/004-receipt-relief-provenance.sql

ALTER TABLE receipts ADD COLUMN IF NOT EXISTS relief_source varchar;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS relief_confidence smallint;
