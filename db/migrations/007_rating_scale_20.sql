-- ============================================================================
-- 007_rating_scale_20.sql — attack/defense/fitness move from a 1-100 to a
-- 1-20 scale. 1-100 (migration 006) turned out to be more precision than
-- useful for a slider; 1-20 keeps twice the resolution of the original 1-10
-- scale without needing three digits.
--
-- Existing 1-100 values are scaled /5 (the inverse of 006's x10 from the
-- original 1-10 values), so ratings land back on their original 1-20
-- equivalent rather than bunching up.
--
-- Idempotent: safe to run more than once.
-- Run as the database owner:
--     psql -d badat_football -f db/migrations/007_rating_scale_20.sql
-- ============================================================================

BEGIN;

ALTER TABLE players DROP CONSTRAINT IF EXISTS players_attack_check;
ALTER TABLE players DROP CONSTRAINT IF EXISTS players_defense_check;
ALTER TABLE players DROP CONSTRAINT IF EXISTS players_fitness_check;

UPDATE players SET
  attack = GREATEST(1, LEAST(ROUND(attack / 5.0), 20)),
  defense = GREATEST(1, LEAST(ROUND(defense / 5.0), 20)),
  fitness = GREATEST(1, LEAST(ROUND(fitness / 5.0), 20))
WHERE attack > 20 OR defense > 20 OR fitness > 20;

ALTER TABLE players ALTER COLUMN attack SET DEFAULT 10;
ALTER TABLE players ALTER COLUMN defense SET DEFAULT 10;
ALTER TABLE players ALTER COLUMN fitness SET DEFAULT 10;

ALTER TABLE players ADD CONSTRAINT players_attack_check CHECK (attack BETWEEN 1 AND 20);
ALTER TABLE players ADD CONSTRAINT players_defense_check CHECK (defense BETWEEN 1 AND 20);
ALTER TABLE players ADD CONSTRAINT players_fitness_check CHECK (fitness BETWEEN 1 AND 20);

COMMIT;
