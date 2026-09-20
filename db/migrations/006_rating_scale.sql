-- ============================================================================
-- 006_rating_scale.sql — attack/defense/fitness move from a 1-10 to a 1-100
-- scale, to support the slider UX (finer-grained than ten notches).
--
-- Existing 1-10 values are scaled x10 so ratings stay proportionally where
-- they were on the new range, rather than all collapsing near the bottom.
--
-- Idempotent: safe to run more than once.
-- Run as the database owner:
--     psql -d badat_football -f db/migrations/006_rating_scale.sql
-- ============================================================================

BEGIN;

ALTER TABLE players DROP CONSTRAINT IF EXISTS players_attack_check;
ALTER TABLE players DROP CONSTRAINT IF EXISTS players_defense_check;
ALTER TABLE players DROP CONSTRAINT IF EXISTS players_fitness_check;

UPDATE players SET
  attack = LEAST(attack * 10, 100),
  defense = LEAST(defense * 10, 100),
  fitness = LEAST(fitness * 10, 100)
WHERE attack <= 10 AND defense <= 10 AND fitness <= 10;

ALTER TABLE players ALTER COLUMN attack SET DEFAULT 50;
ALTER TABLE players ALTER COLUMN defense SET DEFAULT 50;
ALTER TABLE players ALTER COLUMN fitness SET DEFAULT 50;

ALTER TABLE players ADD CONSTRAINT players_attack_check CHECK (attack BETWEEN 1 AND 100);
ALTER TABLE players ADD CONSTRAINT players_defense_check CHECK (defense BETWEEN 1 AND 100);
ALTER TABLE players ADD CONSTRAINT players_fitness_check CHECK (fitness BETWEEN 1 AND 100);

COMMIT;
