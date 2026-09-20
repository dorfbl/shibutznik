-- ============================================================================
-- 010_registration_questionnaire.sql — custom questions on the signup form
--
-- Lets an admin define extra questions (scale / dropdown / radio / multiselect
-- / free text, each optional or required) that a new player answers as a
-- second step after the basic name/phone/password/referral fields. Whether
-- the step is shown at all is a plain org setting (settings.registration_
-- questionnaire_enabled), the same on/off pattern already used for
-- player_stats_visible — no schema needed for that part.
--
-- Idempotent: safe to run more than once.
-- Run as the database owner:
--     psql -d badat_football -f db/migrations/010_registration_questionnaire.sql
-- ============================================================================

BEGIN;

DO $$ BEGIN
  CREATE TYPE registration_question_type AS ENUM ('scale', 'dropdown', 'radio', 'multiselect', 'text');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS registration_questions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  type            registration_question_type NOT NULL,
  -- Option labels for dropdown/radio/multiselect; unused (empty) otherwise.
  options         JSONB NOT NULL DEFAULT '[]',
  -- Endpoints for a scale question; unused otherwise.
  scale_min       SMALLINT,
  scale_max       SMALLINT,
  scale_min_label TEXT,
  scale_max_label TEXT,
  required        BOOLEAN NOT NULL DEFAULT false,
  active          BOOLEAN NOT NULL DEFAULT true,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS registration_questions_org_id_idx ON registration_questions (org_id, sort_order);

CREATE TABLE IF NOT EXISTS registration_answers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  player_id   UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES registration_questions(id) ON DELETE CASCADE,
  -- Single value for scale/dropdown/radio/text; value_list for multiselect.
  value       TEXT,
  value_list  TEXT[],
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (player_id, question_id)
);
CREATE INDEX IF NOT EXISTS registration_answers_player_id_idx ON registration_answers (player_id);

COMMIT;
