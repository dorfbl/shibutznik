-- ============================================================================
-- 015_scheduled_notifications.sql — recurring & scheduled push notifications
--
-- Unifies "recurring every X hours/days" and "schedule for a date/time,
-- one-time or recurring" into one row: next_send_at is when it next fires,
-- repeat_every_hours is NULL for a one-time send or an interval that gets
-- re-added to next_send_at after each send. An in-process interval in
-- server/index.js (this app has no cron/worker process — see its
-- rationale there) checks every minute for anything due.
--
-- Idempotent: safe to run more than once.
-- Run as the database owner:
--     psql -d badat_football -f db/migrations/015_scheduled_notifications.sql
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS scheduled_notifications (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sender_id          UUID REFERENCES players(id) ON DELETE SET NULL,
  title              TEXT NOT NULL,
  body               TEXT NOT NULL,
  audience_type      TEXT NOT NULL,
  audience_params    JSONB NOT NULL DEFAULT '{}',
  audience_label     TEXT NOT NULL,
  next_send_at       TIMESTAMPTZ NOT NULL,
  repeat_every_hours INTEGER,
  active             BOOLEAN NOT NULL DEFAULT true,
  last_sent_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scheduled_notifications_due_idx ON scheduled_notifications (active, next_send_at);
CREATE INDEX IF NOT EXISTS scheduled_notifications_org_idx ON scheduled_notifications (org_id, created_at DESC);

COMMIT;
