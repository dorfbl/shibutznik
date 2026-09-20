-- ============================================================================
-- 005_platform_admins.sql — a role above organizations
--
-- Platform admins are not tied to any org: they can create organizations and
-- assign admins to them, but that alone does not make them an admin (or even
-- a member) of any org — their per-org role, if any, stays whatever
-- player_organizations says it is. Keyed by phone rather than player_id so
-- the flag describes the PERSON, not any one org-scoped players row.
--
-- Idempotent: safe to run more than once.
-- Run as the database owner:
--     psql -d badat_football -f db/migrations/005_platform_admins.sql
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS platform_admins (
  phone      TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO platform_admins (phone) VALUES ('0549674110')
ON CONFLICT (phone) DO NOTHING;

COMMIT;
