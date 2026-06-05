-- Add 'childcare' and 'education' to the LhdnRelief enum so receipts can be
-- tagged for the RM3,000 childcare and RM7,000 self-education reliefs.
-- Postgres allows ADD VALUE outside a transaction; IF NOT EXISTS makes it
-- idempotent. Dev/staging on TypeORM synchronize already applied this.
--
-- Run: psql "$DATABASE_URL" -f migrations/003-lhdn-relief-add-childcare-education.sql

ALTER TYPE receipts_lhdn_relief_enum ADD VALUE IF NOT EXISTS 'childcare';
ALTER TYPE receipts_lhdn_relief_enum ADD VALUE IF NOT EXISTS 'education';
