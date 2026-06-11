-- Receipt → User had NO working cascading FK because the column types diverged:
-- users.id is uuid but receipts.user_id was varchar, so a foreign key between
-- them could never be created. That's why deleting a user left orphan receipt
-- rows, which then surfaced on the leaderboard as "Unknown" entries. This:
--   1. purges existing orphan receipts (no live user),
--   2. converts receipts.user_id varchar -> uuid so a real FK is possible, then
--   3. (re)creates the FK with ON DELETE CASCADE.
-- The Receipt entity declares onDelete: 'CASCADE'; this aligns the live DB with
-- it. Idempotent-ish + transactional: safe to run once on prod. Dev/staging on
-- TypeORM synchronize manages the column itself.
--
-- Run: psql "$DATABASE_URL" -f migrations/006-receipts-user-fk-cascade.sql

BEGIN;

-- 1. Remove orphans (cast varchar -> uuid to compare against users.id).
DELETE FROM receipts r
 WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = r.user_id::uuid);

-- 2. Align column type so a real FK can exist (uuid <-> uuid).
ALTER TABLE receipts
  ALTER COLUMN user_id TYPE uuid USING user_id::uuid;

-- 3. Drop whatever FK (if any) sat on receipts.user_id, then add the cascade FK.
DO $$
DECLARE
  fk_name text;
BEGIN
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
