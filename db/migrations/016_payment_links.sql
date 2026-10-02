-- Payment links (the club pays through an external page, e.g. Fizikal).
--
-- The link and the payer details shown next to it live in the org's settings
-- under the key 'payment_link' as {url, firstName, lastName, idNumber, phone};
-- they are never sent in the general settings, only to a player who has an
-- open payment request (see /api/bootstrap).
--
-- An admin "sends" the link to one player: that stamps the time on the
-- subscription signup or the one-timer's registration, notifies the player,
-- and puts a payment card on their home screen until the admin marks them
-- paid (subscription_signups.paid / registrations.payment_confirmed, which
-- the existing flows already handle).

ALTER TABLE subscription_signups ADD COLUMN IF NOT EXISTS payment_link_sent_at TIMESTAMPTZ;
ALTER TABLE registrations        ADD COLUMN IF NOT EXISTS payment_link_sent_at TIMESTAMPTZ;
