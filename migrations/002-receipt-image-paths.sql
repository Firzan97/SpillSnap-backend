-- Add receipts.image_paths to store every uploaded section of a long receipt.
-- The existing image_url stays as the primary/first section (back-compat).
-- TypeORM 'simple-array' maps to a plain text column (comma-joined).
-- Idempotent + transactional: safe to run once on environments that use
-- migrations (prod). Dev/staging on TypeORM synchronize already applied this.
--
-- Run: psql "$DATABASE_URL" -f migrations/002-receipt-image-paths.sql

BEGIN;

ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS image_paths text;

-- Backfill: seed existing rows with their single image so the API returns it
-- under imageUrls too.
UPDATE receipts
   SET image_paths = image_url
 WHERE image_paths IS NULL
   AND image_url IS NOT NULL;

COMMIT;
