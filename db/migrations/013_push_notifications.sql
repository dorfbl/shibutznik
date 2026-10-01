-- ============================================================================
-- 013_push_notifications.sql — admin push notifications
--
-- Lets an admin send real OS-level push notifications to a chosen audience
-- (everyone, monthly members, one-timers, everyone registered to a fixture,
-- or a hand-picked list). push_subscriptions holds each device's Web Push
-- subscription (a player can have more than one — phone + laptop, etc.);
-- notification_log is the sent-history the admin sees below the composer.
--
-- Idempotent: safe to run more than once.
-- Run as the database owner:
--     psql -d badat_football -f db/migrations/013_push_notifications.sql
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  player_id  UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subscriptions_player_idx ON push_subscriptions (player_id);

CREATE TABLE IF NOT EXISTS notification_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sender_id        UUID REFERENCES players(id) ON DELETE SET NULL,
  title            TEXT NOT NULL,
  body             TEXT NOT NULL,
  audience_type    TEXT NOT NULL,
  audience_label   TEXT NOT NULL,
  recipient_count  INTEGER NOT NULL DEFAULT 0,
  sent_count       INTEGER NOT NULL DEFAULT 0,
  failed_count     INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notification_log_org_idx ON notification_log (org_id, created_at DESC);

COMMIT;
