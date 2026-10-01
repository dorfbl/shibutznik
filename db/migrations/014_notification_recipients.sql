-- ============================================================================
-- 014_notification_recipients.sql — who actually got each notification
--
-- notification_log (013) records that a notification was SENT (to an
-- audience, with tallies) but not WHO specifically received it, so a player
-- who tapped a push notification had nowhere in the app to see it again.
-- This records the exact recipient list at send time, so the app can show
-- each player their own notification history.
--
-- Idempotent: safe to run more than once.
-- Run as the database owner:
--     psql -d badat_football -f db/migrations/014_notification_recipients.sql
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS notification_recipients (
  notification_id UUID NOT NULL REFERENCES notification_log(id) ON DELETE CASCADE,
  player_id        UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  PRIMARY KEY (notification_id, player_id)
);
CREATE INDEX IF NOT EXISTS notification_recipients_player_idx ON notification_recipients (player_id);

COMMIT;
