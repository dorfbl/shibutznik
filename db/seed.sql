INSERT INTO settings (key, value) VALUES
('system', '{"teamSize": 5, "teamsPerPitch": 3, "maxConsecutiveGames": 3, "oneTimePrice": 39, "colors": [{"name":"לבן","hex":"#f8fafc"},{"name":"שחור","hex":"#111827"},{"name":"ירוק","hex":"#22c55e"},{"name":"כחול","hex":"#3b82f6"},{"name":"צהוב","hex":"#facc15"},{"name":"כתום","hex":"#f97316"},{"name":"סגול","hex":"#8b5cf6"},{"name":"אדום","hex":"#ef4444"},{"name":"אפור","hex":"#94a3b8"}]}'::jsonb);

INSERT INTO players (full_name, phone, role, status, avatar_url, joined_at, is_monthly_member, is_senior_pitch, attack, defense, fitness, tags, admin_note) VALUES
('דור כהן', '0501111111', 'player', 'active', 'https://i.pravatar.cc/120?img=12', '2024-03-14', true, false, 14, 14, 16, ARRAY['ותיק'], NULL),
('אבי אריאל', '0502222222', 'admin', 'active', 'https://i.pravatar.cc/120?img=32', '2022-09-01', true, true, 18, 16, 16, ARRAY['אדמין'], NULL),
('מור לוי', '0503333333', 'stats_admin', 'active', 'https://i.pravatar.cc/120?img=15', '2023-02-10', true, true, 16, 16, 18, ARRAY['סטטיסטיקות'], NULL),
('עומר דוידי', '0504444444', 'player', 'active', 'https://i.pravatar.cc/120?img=20', '2023-05-18', true, true, 20, 14, 18, ARRAY['מגרש בכיר'], NULL),
('עמית דוידי', '0505555555', 'player', 'active', 'https://i.pravatar.cc/120?img=21', '2023-05-18', true, true, 16, 16, 16, ARRAY['מגרש בכיר'], NULL),
('אור כהן', '0506666666', 'player', 'active', 'https://i.pravatar.cc/120?img=8', '2024-01-04', false, false, 12, 14, 16, ARRAY[]::TEXT[], NULL),
('שי מנחם', '0507777777', 'player', 'active', 'https://i.pravatar.cc/120?img=36', '2024-06-20', false, false, 12, 12, 14, ARRAY[]::TEXT[], NULL),
('עופר ברינדר', '0508888888', 'player', 'active', 'https://i.pravatar.cc/120?img=44', '2022-11-12', true, false, 14, 16, 12, ARRAY['ותיק'], NULL),
('יוסי בלוך', '0509999999', 'player', 'active', 'https://i.pravatar.cc/120?img=51', '2023-12-01', false, false, 10, 16, 14, ARRAY[]::TEXT[], NULL),
('רועי אלון', '0511111111', 'player', 'active', 'https://i.pravatar.cc/120?img=53', '2024-07-11', true, false, 14, 12, 14, ARRAY[]::TEXT[], NULL),
('אלון פרץ', '0512222222', 'player', 'active', 'https://i.pravatar.cc/120?img=56', '2024-08-30', true, false, 12, 12, 16, ARRAY[]::TEXT[], NULL),
('מוטי חזן', '0513333333', 'player', 'active', 'https://i.pravatar.cc/120?img=57', '2023-03-22', false, false, 10, 14, 12, ARRAY['פצוע קל'], 'לבדוק כשירות לפני שיבוץ'),
('יניב אוחנה', '0514444444', 'player', 'active', 'https://i.pravatar.cc/120?img=58', '2021-10-15', true, true, 18, 18, 16, ARRAY['מגרש בכיר'], NULL),
('טל סהר', '0515555555', 'player', 'active', 'https://i.pravatar.cc/120?img=59', '2025-01-10', false, false, 12, 10, 16, ARRAY['חדש'], NULL),
('ניר גולן', '0516666666', 'player', 'pending', 'https://i.pravatar.cc/120?img=60', '2026-07-20', false, false, 10, 10, 10, ARRAY['חדש'], 'דרך מור');

UPDATE players SET password_hash = encode(digest(phone || ':123456', 'sha256'), 'hex');

INSERT INTO players (full_name, phone, password_hash, role, status, avatar_url, joined_at, is_monthly_member, is_senior_pitch, attack, defense, fitness, tags, admin_note)
SELECT
  full_name,
  phone,
  encode(digest(phone || ':123456', 'sha256'), 'hex'),
  'player',
  'active',
  'https://i.pravatar.cc/120?u=' || phone,
  CURRENT_DATE - ((idx * 17) % 900),
  idx % 3 <> 0,
  idx % 11 = 0,
  2 * (1 + ((idx * 7) % 10)),
  2 * (1 + ((idx * 5 + 3) % 10)),
  2 * (1 + ((idx * 3 + 6) % 10)),
  CASE WHEN idx % 11 = 0 THEN ARRAY['מגרש בכיר'] WHEN idx % 5 = 0 THEN ARRAY['ותיק'] ELSE ARRAY[]::TEXT[] END,
  'שחקן דמו'
FROM (
  VALUES
    (1, 'אדם לוי'), (2, 'ברק סגל'), (3, 'גיא רוזן'), (4, 'דניאל אשר'), (5, 'הראל שמיר'),
    (6, 'זיו עובדיה'), (7, 'חיים ביטון'), (8, 'טום כהן'), (9, 'ישי פלג'), (10, 'כפיר דהן'),
    (11, 'ליאור בר'), (12, 'מאור יצחק'), (13, 'נדב גל'), (14, 'סהר מזרחי'), (15, 'עידו קידר'),
    (16, 'פז אלמליח'), (17, 'צחי דיין'), (18, 'קובי הרוש'), (19, 'רם אביטל'), (20, 'שחר לוין'),
    (21, 'תמיר אלון'), (22, 'אמיר זיו'), (23, 'בן שבת'), (24, 'גל וייס'), (25, 'דביר עמר'),
    (26, 'אלעד נבון'), (27, 'יונתן פריד'), (28, 'כרמל שוהם'), (29, 'לביא שרון'), (30, 'מתן סופר'),
    (31, 'נועם ארז'), (32, 'סער דרור'), (33, 'עומרי חובב'), (34, 'פלג מור'), (35, 'צור ברק'),
    (36, 'רון שפירא'), (37, 'שגיא רז'), (38, 'תום ברמן'), (39, 'אילן גבע'), (40, 'אריק מלכה')
) AS demo(idx, full_name)
CROSS JOIN LATERAL (SELECT '052' || lpad(idx::text, 7, '0') AS phone) ph;

WITH m AS (
  INSERT INTO matches (title, match_date, starts_at, location, status, approved_pitch_count, teams_per_pitch, players_per_team, payment_link, banner)
  VALUES ('מחזור 18', '2026-07-26', '21:30', 'מגרשי כפר סבא', 'teams_published', 1, 3, 5, 'https://pay.example.com/badat', 'השבוע ההגעה עד 21:20 כדי להתחיל בזמן')
  RETURNING id
),
p AS (
  INSERT INTO pitches (match_id, pitch_number, label, is_senior)
  SELECT id, 1, 'מגרש בכיר', true FROM m
  RETURNING id, match_id
),
t AS (
  INSERT INTO teams (pitch_id, color_name, color_hex, sort_order, summary)
  SELECT id, 'כתומים', '#f97316', 1, 'ערב מאוזן וחד עם הרבה תנועה לעומק.' FROM p
  UNION ALL SELECT id, 'שחורים', '#111827', 2, 'לחצו גבוה ונשארו קרובים עד הסוף.' FROM p
  UNION ALL SELECT id, 'לבנים', '#f8fafc', 3, 'משחק קבוצתי מסודר עם כמה מהלכים יפים.' FROM p
  RETURNING id, pitch_id, color_name
)
INSERT INTO registrations (match_id, player_id, status, payment_confirmed)
SELECT (SELECT id FROM m), id, 'attending', is_monthly_member FROM players WHERE status = 'active' LIMIT 15;

INSERT INTO registrations (match_id, player_id, status, payment_confirmed)
SELECT m.id, p.id, 'standby', p.is_monthly_member
FROM matches m
JOIN players p ON p.status = 'active'
WHERE m.title = 'מחזור 18'
ON CONFLICT (match_id, player_id) DO NOTHING;

INSERT INTO team_players (team_id, player_id)
SELECT t.id, p.id
FROM teams t
JOIN pitches pi ON pi.id = t.pitch_id
JOIN matches m ON m.id = pi.match_id
JOIN players p ON p.full_name = ANY(
  CASE t.color_name
    WHEN 'כתומים' THEN ARRAY['עומר דוידי','עופר ברינדר','רועי אלון','טל סהר','דור כהן']
    WHEN 'שחורים' THEN ARRAY['אבי אריאל','מור לוי','יניב אוחנה','יוסי בלוך','אלון פרץ']
    ELSE ARRAY['אור כהן','שי מנחם','עמית דוידי','מוטי חזן','ניר גולן']
  END
)
WHERE m.title = 'מחזור 18';

WITH pitch AS (
  SELECT pi.id FROM pitches pi JOIN matches m ON m.id = pi.match_id WHERE m.title = 'מחזור 18' LIMIT 1
),
orange AS (SELECT t.id FROM teams t JOIN pitch ON pitch.id = t.pitch_id WHERE t.color_name = 'כתומים'),
black AS (SELECT t.id FROM teams t JOIN pitch ON pitch.id = t.pitch_id WHERE t.color_name = 'שחורים'),
white AS (SELECT t.id FROM teams t JOIN pitch ON pitch.id = t.pitch_id WHERE t.color_name = 'לבנים'),
g1 AS (
  INSERT INTO game_results (pitch_id, team_a_id, team_b_id, team_a_goals, team_b_goals, ended_by, sort_order)
  SELECT pitch.id, orange.id, black.id, 2, 1, 'two_goals', 1 FROM pitch, orange, black RETURNING id
),
g2 AS (
  INSERT INTO game_results (pitch_id, team_a_id, team_b_id, team_a_goals, team_b_goals, ended_by, sort_order)
  SELECT pitch.id, orange.id, white.id, 1, 1, 'time', 2 FROM pitch, orange, white RETURNING id
),
g3 AS (
  INSERT INTO game_results (pitch_id, team_a_id, team_b_id, team_a_goals, team_b_goals, ended_by, sort_order)
  SELECT pitch.id, black.id, white.id, 2, 0, 'two_goals', 3 FROM pitch, black, white RETURNING id
)
INSERT INTO goal_events (game_id, scorer_id, assist_id, team_id)
SELECT (SELECT id FROM g1), scorer.id, assist.id, (SELECT id FROM orange) FROM players scorer LEFT JOIN players assist ON assist.full_name = 'עופר ברינדר' WHERE scorer.full_name = 'עומר דוידי'
UNION ALL SELECT (SELECT id FROM g1), scorer.id, assist.id, (SELECT id FROM orange) FROM players scorer LEFT JOIN players assist ON assist.full_name = 'דור כהן' WHERE scorer.full_name = 'דור כהן'
UNION ALL SELECT (SELECT id FROM g1), scorer.id, assist.id, (SELECT id FROM black) FROM players scorer LEFT JOIN players assist ON assist.full_name = 'מור לוי' WHERE scorer.full_name = 'אבי אריאל'
UNION ALL SELECT (SELECT id FROM g2), scorer.id, assist.id, (SELECT id FROM orange) FROM players scorer LEFT JOIN players assist ON assist.full_name = 'עמית דוידי' WHERE scorer.full_name = 'עומר דוידי'
UNION ALL SELECT (SELECT id FROM g2), scorer.id, NULL, (SELECT id FROM white) FROM players scorer WHERE scorer.full_name = 'אור כהן'
UNION ALL SELECT (SELECT id FROM g3), scorer.id, assist.id, (SELECT id FROM black) FROM players scorer LEFT JOIN players assist ON assist.full_name = 'מור לוי' WHERE scorer.full_name = 'אבי אריאל'
UNION ALL SELECT (SELECT id FROM g3), scorer.id, assist.id, (SELECT id FROM black) FROM players scorer LEFT JOIN players assist ON assist.full_name = 'אבי אריאל' WHERE scorer.full_name = 'מור לוי';

INSERT INTO match_standouts (match_id, player_id, reason, sort_order)
SELECT m.id, p.id, reason, sort_order
FROM matches m
JOIN (
  VALUES
    ('עומר דוידי', 'צמד ושער חשוב בתיקו', 1),
    ('אבי אריאל', 'שלושה שערים ולחץ גבוה', 2),
    ('מור לוי', 'שער ושני בישולים', 3),
    ('עופר ברינדר', 'ניהול משחק ובישול', 4),
    ('אור כהן', 'שער שוויון ונוכחות חזקה', 5)
) AS s(full_name, reason, sort_order) ON true
JOIN players p ON p.full_name = s.full_name
WHERE m.title = 'מחזור 18';

INSERT INTO audit_log (action, entity_type, after_value)
VALUES
('seed_database', 'system', '{"message":"Initial Hebrew demo data loaded"}'::jsonb);
