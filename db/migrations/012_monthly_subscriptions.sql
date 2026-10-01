-- ============================================================================
-- 012_monthly_subscriptions.sql — the monthly subscription billing cycle
--
-- players.is_monthly_member used to be a flat flag an admin flipped by hand,
-- with no time dimension — membership status silently drifted out of sync
-- with who was actually current on payment. This adds a real monthly cycle:
-- an admin picks which days count this month (defaulting to every Sunday)
-- and a price per match, players opt in with one tap, the admin tracks
-- payment manually (no payment gateway — this app never stores a payment
-- link for it) and marks people paid, and is_monthly_member becomes a
-- CONSEQUENCE of paying that month's subscription (set true on payment, and
-- reset to false for anyone who didn't renew by the time the admin opens the
-- next month — there is no scheduler in this app, so that reset is a side
-- effect of the admin's own "publish next month" action).
--
-- No stored total and no stored amount-due: both are always computed live
-- (days x price, and total minus players.credits) so they can never drift
-- from the numbers actually shown.
--
-- Idempotent: safe to run more than once.
-- Run as the database owner:
--     psql -d badat_football -f db/migrations/012_monthly_subscriptions.sql
-- ============================================================================

BEGIN;

DO $$ BEGIN
  CREATE TYPE monthly_subscription_status AS ENUM ('draft', 'open');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS monthly_subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  year            SMALLINT NOT NULL,
  month           SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  price_per_match INTEGER NOT NULL DEFAULT 39 CHECK (price_per_match >= 0),
  -- Sorted 'YYYY-MM-DD' strings. No separate total column — total is ALWAYS
  -- jsonb_array_length(match_dates) * price_per_match, computed on read.
  match_dates     JSONB NOT NULL DEFAULT '[]',
  status          monthly_subscription_status NOT NULL DEFAULT 'draft',
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, year, month)
);
CREATE INDEX IF NOT EXISTS monthly_subscriptions_org_idx
  ON monthly_subscriptions (org_id, status, year DESC, month DESC);

CREATE TABLE IF NOT EXISTS subscription_signups (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL REFERENCES monthly_subscriptions(id) ON DELETE CASCADE,
  player_id       UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  paid            BOOLEAN NOT NULL DEFAULT false,
  paid_at         TIMESTAMPTZ,
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, player_id)
);
CREATE INDEX IF NOT EXISTS subscription_signups_subscription_idx
  ON subscription_signups (subscription_id);

COMMIT;
