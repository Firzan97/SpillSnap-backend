-- Receipt → User FK was created WITHOUT ON DELETE CASCADE on older databases, so
-- deleting a user left orphan receipt rows. Those orphans surfaced on the
-- leaderboard as "Unknown" entries (no matching profile row). This migration:
--   1. purges existing orphan receipts (no live user), then
--   2. rebuilds the FK with ON DELETE CASCADE so future deletes cascade cleanly.
-- The Receipt entity already declares onDelete: 'CASCADE'; this aligns the live
-- DB constraint with it. Idempotent + transactional: safe to run once on prod.
-- Dev/staging on TypeORM synchronize already has the cascade.
--
-- Run: psql "$DATABASE_URL" -f migrations/006-receipts-user-fk-cascade.sql

BEGIN;

-- 1. Remove orphans left behind by a non-cascading FK.
DELETE FROM receipts r
 WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = r.user_id);

-- 2. Rebuild the user_id FK with ON DELETE CASCADE.
DO $$
DECLARE
  fk_name text;
BEGIN
  -- Find whatever name the existing FK on receipts.user_id was given.
  SELECT con.conname INTO fk_name
    FROM pg_constraint con
    JOIN pg_class rel       ON rel.oid = con.conrelid
    JOIN pg_attribute att    ON att.attrelid = con.conrelid
                            AND att.attnum = ANY (con.conkey)
   WHERE con.contype = 'f'
     AND rel.relname = 'receipts'
     AND att.attname = 'user_id'
   LIMIT 1;

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE receipts DROP CONSTRAINT %I', fk_name);
  END IF;

  ALTER TABLE receipts
    ADD CONSTRAINT fk_receipts_user_id
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
END $$;

COMMIT;
