-- ============================================================================
-- 003_org_join_codes.sql — private clubs
--
-- GET /api/organizations used to return every active club, so the login page
-- listed them all in a dropdown and anyone could see (and request to join) a
-- club they were never told about. That endpoint is gone.
--
-- Each organization now has a join_code: a short, human-typeable secret shared
-- out of band. It is the ONLY way to reach a club — the login page names no
-- club until a valid code resolves to one, and signing up requires it too.
--
-- Existing clubs get a generated code. Print them after migrating and hand
-- them to your players:
--     SELECT name, slug, join_code FROM organizations;
--
-- Idempotent: safe to run more than once.
-- Run as the database owner:
--     psql -d badat_football -f db/migrations/003_org_join_codes.sql
-- ============================================================================

BEGIN;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS join_code TEXT;

-- ---------------------------------------------------------------- backfill
-- A readable code: no O/0/I/1 so it survives being read aloud or copied by
-- hand. gen_random_bytes comes from pgcrypto, already required by the schema.
-- The `WHERE o.id IS NOT NULL` correlates the subquery to the row being
-- updated. Without it Postgres evaluates the subquery ONCE and hands every
-- organization the same code, which then trips the unique index below.
UPDATE organizations o
   SET join_code = (
     SELECT string_agg(
       substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
              (get_byte(gen_random_bytes(1), 0) % 32) + 1, 1),
       '')
     FROM generate_series(1, 6) s
     WHERE o.id IS NOT NULL
   )
 WHERE o.join_code IS NULL;

ALTER TABLE organizations ALTER COLUMN join_code SET NOT NULL;

-- Codes are compared case-insensitively (people type them in either case), so
-- uniqueness must be enforced the same way.
CREATE UNIQUE INDEX IF NOT EXISTS organizations_join_code_key
  ON organizations (upper(join_code));

COMMIT;
