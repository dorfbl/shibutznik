-- ============================================================================
-- 008_own_goal_flag.sql — explicit own-goal flag on goal_events
--
-- An own goal was always representable (scorer credited to the OTHER team's
-- tally than their own roster), but nothing stored that on purpose — every
-- reader had to infer it by cross-referencing team_players, which is fragile
-- (breaks if a player is later moved between teams) and nobody actually did
-- it, so own goals silently displayed as a normal goal by that player. This
-- makes the intent explicit instead of inferred.
--
-- Idempotent: safe to run more than once.
-- Run as the database owner:
--     psql -d badat_football -f db/migrations/008_own_goal_flag.sql
-- ============================================================================

BEGIN;

ALTER TABLE goal_events
  ADD COLUMN IF NOT EXISTS own_goal BOOLEAN NOT NULL DEFAULT false;

COMMIT;
