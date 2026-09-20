-- ============================================================================
-- 001_organizations.sql — multi-tenancy
--
-- Adds organizations and scopes every tenant-owned table by org_id.
-- Players may belong to MULTIPLE organizations, with a per-org role, via the
-- player_organizations join table.
--
-- All existing data is backfilled into one default organization, so the app
-- behaves exactly as before after migrating.
--
-- Idempotent: safe to run more than once.
-- Run as the database owner:
--     psql -d badat_football -f db/migrations/001_organizations.sql
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------- organizations
CREATE TABLE IF NOT EXISTS organizations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  logo_url   TEXT,
  timezone   TEXT NOT NULL DEFAULT 'Asia/Jerusalem',
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The default org that adopts all pre-existing rows.
INSERT INTO organizations (name, slug)
SELECT 'גרועים בכדורגל', 'default'
WHERE NOT EXISTS (SELECT 1 FROM organizations WHERE slug = 'default');

-- ------------------------------------------------------- add org_id to tables
-- players.org_id is the player's PRIMARY/home org (kept for convenient defaults
-- and for scoping the unique phone constraint); full membership lives in
-- player_organizations below.
ALTER TABLE players          ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE matches          ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE settings         ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE audit_log        ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

-- Descendant tables carry org_id too: it makes every query directly scopeable
-- without multi-level joins, and lets the DB enforce isolation.
ALTER TABLE registrations    ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE pitches          ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE teams            ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE team_players     ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE game_results     ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE goal_events      ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE match_standouts  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

-- ------------------------------------------------------------------ backfill
DO $$
DECLARE default_org UUID;
BEGIN
  SELECT id INTO default_org FROM organizations WHERE slug = 'default';

  UPDATE players         SET org_id = default_org WHERE org_id IS NULL;
  UPDATE matches         SET org_id = default_org WHERE org_id IS NULL;
  UPDATE settings        SET org_id = default_org WHERE org_id IS NULL;
  UPDATE audit_log       SET org_id = default_org WHERE org_id IS NULL;

  -- Descendants inherit from their parent so nothing is mis-assigned.
  UPDATE registrations r   SET org_id = m.org_id FROM matches m  WHERE r.match_id = m.id AND r.org_id IS NULL;
  UPDATE pitches p         SET org_id = m.org_id FROM matches m  WHERE p.match_id = m.id AND p.org_id IS NULL;
  UPDATE teams t           SET org_id = p.org_id FROM pitches p  WHERE t.pitch_id = p.id AND t.org_id IS NULL;
  UPDATE team_players tp   SET org_id = t.org_id FROM teams t    WHERE tp.team_id = t.id AND tp.org_id IS NULL;
  UPDATE game_results g    SET org_id = p.org_id FROM pitches p  WHERE g.pitch_id = p.id AND g.org_id IS NULL;
  UPDATE goal_events ge    SET org_id = g.org_id FROM game_results g WHERE ge.game_id = g.id AND ge.org_id IS NULL;
  UPDATE match_standouts s SET org_id = m.org_id FROM matches m  WHERE s.match_id = m.id AND s.org_id IS NULL;

  -- Anything still orphaned (parent row missing) goes to the default org.
  UPDATE registrations   SET org_id = default_org WHERE org_id IS NULL;
  UPDATE pitches         SET org_id = default_org WHERE org_id IS NULL;
  UPDATE teams           SET org_id = default_org WHERE org_id IS NULL;
  UPDATE team_players    SET org_id = default_org WHERE org_id IS NULL;
  UPDATE game_results    SET org_id = default_org WHERE org_id IS NULL;
  UPDATE goal_events     SET org_id = default_org WHERE org_id IS NULL;
  UPDATE match_standouts SET org_id = default_org WHERE org_id IS NULL;
END $$;

-- ------------------------------------------------------- enforce NOT NULL
ALTER TABLE players          ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE matches          ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE settings         ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE registrations    ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE pitches          ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE teams            ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE team_players     ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE game_results     ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE goal_events      ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE match_standouts  ALTER COLUMN org_id SET NOT NULL;
-- audit_log stays nullable: system-level events may have no org context.

-- ------------------------------------------------- membership (multi-org)
CREATE TABLE IF NOT EXISTS player_organizations (
  player_id  UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role       player_role   NOT NULL DEFAULT 'player',
  status     player_status NOT NULL DEFAULT 'active',
  is_monthly_member BOOLEAN NOT NULL DEFAULT false,
  is_senior_pitch   BOOLEAN NOT NULL DEFAULT false,
  joined_at  DATE NOT NULL DEFAULT CURRENT_DATE,
  PRIMARY KEY (player_id, org_id)
);

-- Every existing player becomes a member of their current org, carrying over
-- the role/status/flags they already had.
INSERT INTO player_organizations (player_id, org_id, role, status, is_monthly_member, is_senior_pitch, joined_at)
SELECT id, org_id, role, status, is_monthly_member, is_senior_pitch, joined_at
FROM players
ON CONFLICT (player_id, org_id) DO NOTHING;

-- ------------------------------------------------------------ constraints
-- Phone was globally unique; it must now be unique PER ORG so the same number
-- can exist in two different clubs.
ALTER TABLE players DROP CONSTRAINT IF EXISTS players_phone_key;
CREATE UNIQUE INDEX IF NOT EXISTS players_org_phone_key ON players (org_id, phone);

-- Re-scope existing uniqueness to the org.
ALTER TABLE pitches DROP CONSTRAINT IF EXISTS pitches_match_id_pitch_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS pitches_org_match_number_key ON pitches (org_id, match_id, pitch_number);

ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_match_id_player_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS registrations_org_match_player_key ON registrations (org_id, match_id, player_id);

-- ---------------------------------------------------------------- indexes
CREATE INDEX IF NOT EXISTS idx_players_org         ON players(org_id);
CREATE INDEX IF NOT EXISTS idx_matches_org         ON matches(org_id, match_date DESC);
CREATE INDEX IF NOT EXISTS idx_registrations_org   ON registrations(org_id, match_id, status);
CREATE INDEX IF NOT EXISTS idx_pitches_org         ON pitches(org_id, match_id);
CREATE INDEX IF NOT EXISTS idx_teams_org           ON teams(org_id, pitch_id);
CREATE INDEX IF NOT EXISTS idx_team_players_org    ON team_players(org_id, team_id);
CREATE INDEX IF NOT EXISTS idx_game_results_org    ON game_results(org_id, pitch_id);
CREATE INDEX IF NOT EXISTS idx_goal_events_org     ON goal_events(org_id, game_id);
CREATE INDEX IF NOT EXISTS idx_standouts_org       ON match_standouts(org_id, match_id);
CREATE INDEX IF NOT EXISTS idx_audit_org           ON audit_log(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_player_orgs_org     ON player_organizations(org_id, status);

-- settings key was the PK; it must now be per-org.
ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS settings_org_key_idx ON settings (org_id, key);

COMMIT;
