-- Auth migrated from Supabase to Clerk. The local mirror column that linked our
-- profile row to the external auth user is renamed supabase_id -> clerk_id, and
-- its type changes from uuid to varchar (Clerk ids are strings like "user_2abc…",
-- not UUIDs). Idempotent + transactional: safe to run once on prod. Dev/staging
-- on TypeORM synchronize already applied this.
--
-- NOTE: existing rows keep their old Supabase id string under clerk_id, which
-- will NOT match a Clerk session's `sub`. On each user's first Clerk sign-in the
-- backend re-links the row by email (see AuthService.syncFromClerk), so no data
-- is lost — the stale value is simply overwritten with the Clerk user id.
--
-- Run: psql "$DATABASE_URL" -f migrations/005-supabase-id-to-clerk-id.sql

BEGIN;

DO $$
BEGIN
  -- Rename the column only if it hasn't been renamed already.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'users' AND column_name = 'supabase_id'
  ) THEN
    ALTER TABLE users RENAME COLUMN supabase_id TO clerk_id;
  END IF;

  -- Widen uuid -> varchar so Clerk's string ids fit.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'users'
       AND column_name = 'clerk_id'
       AND data_type = 'uuid'
  ) THEN
    ALTER TABLE users
      ALTER COLUMN clerk_id TYPE varchar USING clerk_id::text;
  END IF;
END $$;

COMMIT;
