CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE player_role AS ENUM ('player', 'stats_admin', 'admin');
CREATE TYPE player_status AS ENUM ('pending', 'active', 'inactive', 'blocked');
-- Progress only. Registration openness is independent — see matches.members_can_register
-- / one_timers_can_register — so a fixture can take one-timers while teams are built.
CREATE TYPE match_status AS ENUM ('draft', 'teams_draft', 'teams_published', 'finished', 'stats_published');
CREATE TYPE registration_status AS ENUM ('attending', 'not_attending', 'standby', 'payment_pending', 'cancelled');
CREATE TYPE registration_question_type AS ENUM ('scale', 'dropdown', 'radio', 'multiselect', 'text');

CREATE TABLE organizations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  -- Shared out of band; the ONLY way a club is reached from the login page.
  -- Clubs are never enumerated publicly, so this is what identifies one.
  join_code  TEXT NOT NULL,
  logo_url   TEXT,
  timezone   TEXT NOT NULL DEFAULT 'Asia/Jerusalem',
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Codes are matched case-insensitively, so uniqueness must be too.
CREATE UNIQUE INDEX organizations_join_code_key ON organizations (upper(join_code));

CREATE TABLE settings (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  PRIMARY KEY (org_id, key)
);

CREATE TABLE players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  password_hash TEXT,
  role player_role NOT NULL DEFAULT 'player',
  status player_status NOT NULL DEFAULT 'pending',
  avatar_url TEXT,
  joined_at DATE NOT NULL DEFAULT CURRENT_DATE,
  is_monthly_member BOOLEAN NOT NULL DEFAULT false,
  is_senior_pitch BOOLEAN NOT NULL DEFAULT false,
  attack SMALLINT NOT NULL DEFAULT 10 CHECK (attack BETWEEN 1 AND 20),
  defense SMALLINT NOT NULL DEFAULT 10 CHECK (defense BETWEEN 1 AND 20),
  fitness SMALLINT NOT NULL DEFAULT 10 CHECK (fitness BETWEEN 1 AND 20),
  tags TEXT[] NOT NULL DEFAULT '{}',
  admin_note TEXT,
  -- Redeemable balance: granted when a cancellation is approved "with
  -- credit", spent automatically on the player's next one-timer registration.
  credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Free-form, append-only notes an admin adds to a player over time (distinct
-- from players.admin_note, which is the "how they heard about us" reason
-- captured at signup).
CREATE TABLE player_notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  player_id  UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  author_id  UUID REFERENCES players(id) ON DELETE SET NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX player_notes_player_id_idx ON player_notes (player_id, created_at DESC);

-- Custom questions an admin adds to the signup form (see
-- registration_questionnaire_enabled in settings for the on/off switch),
-- and the answers new players give to them.
CREATE TABLE registration_questions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  type            registration_question_type NOT NULL,
  options         JSONB NOT NULL DEFAULT '[]',
  scale_min       SMALLINT,
  scale_max       SMALLINT,
  scale_min_label TEXT,
  scale_max_label TEXT,
  required        BOOLEAN NOT NULL DEFAULT false,
  active          BOOLEAN NOT NULL DEFAULT true,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX registration_questions_org_id_idx ON registration_questions (org_id, sort_order);

CREATE TABLE registration_answers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  player_id   UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES registration_questions(id) ON DELETE CASCADE,
  value       TEXT,
  value_list  TEXT[],
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (player_id, question_id)
);
CREATE INDEX registration_answers_player_id_idx ON registration_answers (player_id);

CREATE TABLE matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  match_date DATE NOT NULL,
  starts_at TIME NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  status match_status NOT NULL DEFAULT 'draft',
  -- The two registration audiences are independent of status and of each other:
  -- subscribers only, one-timers only, both, or neither are all valid.
  members_can_register BOOLEAN NOT NULL DEFAULT false,
  one_timers_can_register BOOLEAN NOT NULL DEFAULT false,
  approved_pitch_count INTEGER NOT NULL DEFAULT 0 CHECK (approved_pitch_count >= 0),
  teams_per_pitch INTEGER NOT NULL DEFAULT 3 CHECK (teams_per_pitch > 1),
  players_per_team INTEGER NOT NULL DEFAULT 5 CHECK (players_per_team > 0),
  one_time_price INTEGER NOT NULL DEFAULT 39,
  payment_link TEXT,
  public_show_roster BOOLEAN NOT NULL DEFAULT true,
  public_show_standby BOOLEAN NOT NULL DEFAULT true,
  public_show_teams BOOLEAN NOT NULL DEFAULT true,
  banner TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status registration_status NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancellation_reason TEXT,
  cancellation_review TEXT,
  payment_confirmed BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (org_id, match_id, player_id)
);

CREATE TABLE pitches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  pitch_number INTEGER NOT NULL,
  label TEXT NOT NULL,
  is_senior BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (org_id, match_id, pitch_number)
);

CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pitch_id UUID NOT NULL REFERENCES pitches(id) ON DELETE CASCADE,
  color_name TEXT NOT NULL,
  color_hex TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  summary TEXT,
  UNIQUE (pitch_id, sort_order)
);

CREATE TABLE team_players (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, player_id)
);

CREATE TABLE game_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pitch_id UUID NOT NULL REFERENCES pitches(id) ON DELETE CASCADE,
  team_a_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  team_b_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  team_a_goals INTEGER NOT NULL DEFAULT 0,
  team_b_goals INTEGER NOT NULL DEFAULT 0,
  ended_by TEXT NOT NULL DEFAULT 'time',
  sort_order INTEGER NOT NULL
);

CREATE TABLE goal_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  game_id UUID NOT NULL REFERENCES game_results(id) ON DELETE CASCADE,
  scorer_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  assist_id UUID REFERENCES players(id) ON DELETE SET NULL,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  -- team_id is who the goal is CREDITED to, which differs from the scorer's
  -- own roster exactly when this is true.
  own_goal BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE match_standouts (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  reason TEXT,
  sort_order INTEGER NOT NULL CHECK (sort_order BETWEEN 1 AND 5),
  PRIMARY KEY (match_id, player_id)
);

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES players(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  before_value JSONB,
  after_value JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE player_organizations (
  player_id  UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role       player_role   NOT NULL DEFAULT 'player',
  status     player_status NOT NULL DEFAULT 'active',
  is_monthly_member BOOLEAN NOT NULL DEFAULT false,
  is_senior_pitch   BOOLEAN NOT NULL DEFAULT false,
  joined_at  DATE NOT NULL DEFAULT CURRENT_DATE,
  PRIMARY KEY (player_id, org_id)
);

CREATE TABLE platform_admins (
  phone      TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO platform_admins (phone) VALUES ('0549674110');

CREATE UNIQUE INDEX players_org_phone_key ON players (org_id, phone);
CREATE INDEX idx_players_org ON players(org_id);
CREATE INDEX idx_matches_org ON matches(org_id, match_date DESC);
CREATE INDEX idx_player_orgs_org ON player_organizations(org_id, status);
CREATE INDEX idx_registrations_match_status ON registrations(match_id, status);
CREATE INDEX idx_team_players_player ON team_players(player_id);
CREATE INDEX idx_goal_events_scorer ON goal_events(scorer_id);
CREATE INDEX idx_goal_events_assist ON goal_events(assist_id);
