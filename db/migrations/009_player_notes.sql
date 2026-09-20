-- ============================================================================
-- 009_player_notes.sql — a running log of admin notes per player
--
-- players.admin_note stays as-is (it doubles as the free-text "how they
-- heard about the club" reason captured at signup — see the /api/players
-- handler — so it's not purely an admin note and isn't safe to repurpose).
-- This adds a separate, append-only log for admins to freely add notes to a
-- player over time: each entry keeps who wrote it and when, instead of a
-- single box that the next save would overwrite.
--
-- Idempotent: safe to run more than once.
-- Run as the database owner:
--     psql -d badat_football -f db/migrations/009_player_notes.sql
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS player_notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  player_id  UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  author_id  UUID REFERENCES players(id) ON DELETE SET NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS player_notes_player_id_idx ON player_notes (player_id, created_at DESC);

COMMIT;
