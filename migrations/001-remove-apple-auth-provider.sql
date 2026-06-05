-- Remove 'apple' from the AuthProvider enum (Apple SSO dropped).
-- Postgres can't DROP a value from an enum in place, so we swap the type.
-- Idempotent + transactional: safe to run once on environments that use
-- migrations (prod). Dev/staging on TypeORM synchronize already applied this.
--
-- Run: psql "$DATABASE_URL" -f migrations/001-remove-apple-auth-provider.sql

BEGIN;

-- 1. Reassign any leftover Apple users so the type swap doesn't fail.
UPDATE users
   SET auth_provider = 'email'
 WHERE auth_provider::text = 'apple';

-- 2. Recreate the enum without 'apple' (only when it still has it).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'users_auth_provider_enum'
       AND e.enumlabel = 'apple'
  ) THEN
    ALTER TYPE users_auth_provider_enum RENAME TO users_auth_provider_enum_old;
    CREATE TYPE users_auth_provider_enum AS ENUM ('email', 'google');

    ALTER TABLE users ALTER COLUMN auth_provider DROP DEFAULT;
    ALTER TABLE users
      ALTER COLUMN auth_provider TYPE users_auth_provider_enum
      USING auth_provider::text::users_auth_provider_enum;
    ALTER TABLE users ALTER COLUMN auth_provider SET DEFAULT 'email';

    DROP TYPE users_auth_provider_enum_old;
  END IF;
END $$;

COMMIT;
