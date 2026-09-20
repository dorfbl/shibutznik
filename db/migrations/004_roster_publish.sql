-- ============================================================================
-- 004_roster_publish.sql — publish the registration order before teams exist
--
-- Admins want to show players "who's coming" during the week while
-- registration is still open and no teams have been built yet — a flat,
-- first-come-first-served list, not a lineup. This is independent of
-- match_status and of the team-publish flow: it can be toggled on/off at any
-- point, same as members_can_register / one_timers_can_register.
--
-- Idempotent: safe to run more than once.
-- Run as the database owner:
--     psql -d badat_football -f db/migrations/004_roster_publish.sql
-- ============================================================================

BEGIN;

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS roster_published BOOLEAN NOT NULL DEFAULT false;

COMMIT;
