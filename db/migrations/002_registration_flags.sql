-- ============================================================================
-- 002_registration_flags.sql — decouple registration from the match flow
--
-- Registration openness used to be a value of matches.status, which forced the
-- stages into one line: a fixture could not be open to one-timers only, and
-- building teams silently closed registration (it set status = 'teams_draft').
--
-- Openness now lives on two independent booleans, so any combination is legal:
--     subscribers only -> (true,  false)
--     one-timers only  -> (false, true)
--     open to all      -> (true,  true)
--     closed           -> (false, false)
-- matches.status keeps ONLY the progress axis: draft -> teams_draft ->
-- teams_published -> finished -> stats_published. The two no longer constrain
-- each other.
--
-- Existing rows are backfilled from their current status, so behaviour is
-- unchanged until an admin actually toggles something. The retired
-- 'members_open' / 'all_open' / 'registration_closed' statuses collapse to
-- 'draft', carrying their openness over to the new flags.
--
-- Idempotent: safe to run more than once.
-- Run as the database owner:
--     psql -d badat_football -f db/migrations/002_registration_flags.sql
-- ============================================================================

BEGIN;

-- ------------------------------------------------------------- new columns
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS members_can_register    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS one_timers_can_register BOOLEAN NOT NULL DEFAULT false;

-- --------------------------------------------------------------- backfill
-- Only for rows still carrying a retired status; re-running this migration
-- after the statuses are gone is a no-op.
UPDATE matches
   SET members_can_register    = true,
       one_timers_can_register = false
 WHERE status::text = 'members_open';

UPDATE matches
   SET members_can_register    = true,
       one_timers_can_register = true
 WHERE status::text = 'all_open';

-- 'registration_closed' keeps both flags false — the column defaults already
-- say so, and an explicit UPDATE would clobber a re-run.

-- ------------------------------------------------- collapse retired statuses
-- The three registration statuses no longer describe progress. They all mean
-- "teams not built yet", which is exactly 'draft'.
UPDATE matches
   SET status = 'draft'
 WHERE status::text IN ('members_open', 'all_open', 'registration_closed');

-- ------------------------------------------------------- shrink the enum
-- Postgres cannot drop enum values, so the type is rebuilt without them.
-- Guarded so a second run finds nothing to do.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'match_status'
      AND e.enumlabel IN ('members_open', 'all_open', 'registration_closed')
  ) THEN
    CREATE TYPE match_status_new AS ENUM (
      'draft', 'teams_draft', 'teams_published', 'finished', 'stats_published'
    );

    ALTER TABLE matches ALTER COLUMN status DROP DEFAULT;
    ALTER TABLE matches
      ALTER COLUMN status TYPE match_status_new
      USING status::text::match_status_new;
    ALTER TABLE matches ALTER COLUMN status SET DEFAULT 'draft';

    DROP TYPE match_status;
    ALTER TYPE match_status_new RENAME TO match_status;
  END IF;
END
$$;

COMMIT;
