-- ============================================================================
-- 011_player_credits.sql — a redeemable credit balance per player
--
-- A credit is granted to a player when an admin approves a cancellation
-- "with credit" (see the "אשר זיכוי" action on PATCH /api/admin/registrations/
-- :id, body.credited = true) — the idea being they were committed to a slot
-- (a monthly member's month, or a one-timer's payment) but didn't get to use
-- it. A credit is spent automatically the next time that player registers
-- as a one-timer: instead of going to payment_pending, the registration is
-- marked paid immediately and the balance drops by one.
--
-- Idempotent: safe to run more than once.
-- Run as the database owner:
--     psql -d badat_football -f db/migrations/011_player_credits.sql
-- ============================================================================

BEGIN;

ALTER TABLE players ADD COLUMN IF NOT EXISTS credits INTEGER NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE players ADD CONSTRAINT players_credits_non_negative CHECK (credits >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
