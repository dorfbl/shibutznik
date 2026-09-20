import express from "express";
import cors from "cors";
import morgan from "morgan";
import dotenv from "dotenv";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import multer from "multer";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { query, withClient } from "./db.js";

dotenv.config();

const app = express();
const port = Number(process.env.API_PORT || 3015);

app.use(cors({ origin: process.env.WEB_ORIGIN || true }));
app.use(express.json());
app.use(morgan("dev"));

// Profile photos, uploaded during signup or from the profile screen. Served
// under /api/uploads so the existing /api/ reverse-proxy rule covers it too —
// no separate proxy location needed on the host.
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const AVATAR_EXTENSIONS = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };
const uploadAvatar = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${AVATAR_EXTENSIONS[file.mimetype] || ""}`)
  }),
  fileFilter: (_req, file, cb) => cb(null, Boolean(AVATAR_EXTENSIONS[file.mimetype])),
  limits: { fileSize: 5 * 1024 * 1024 }
});
app.use("/api/uploads", express.static(UPLOAD_DIR));

app.post("/api/uploads/avatar", (req, res) => {
  uploadAvatar.single("avatar")(req, res, (err) => {
    if (err || !req.file) return res.status(400).json({ error: "יש להעלות תמונה (jpg/png/webp/gif) עד 5MB" });
    res.status(201).json({ url: `/api/uploads/${req.file.filename}` });
  });
});

const playerFields = `
  id, full_name, phone, role, status, avatar_url, joined_at,
  is_monthly_member, is_senior_pitch, tags
`;

const publicPlayerSelect = (alias = "p") => `
  ${alias}.id,
  ${alias}.full_name,
  ${alias}.phone,
  ${alias}.role,
  ${alias}.status,
  ${alias}.avatar_url,
  ${alias}.joined_at,
  ${alias}.is_monthly_member,
  ${alias}.is_senior_pitch,
  ${alias}.tags
`;

const FIXED_TEAM_COLORS = [
  ["לבן", "#f8fafc"],
  ["שחור", "#111827"],
  ["ירוק", "#22c55e"],
  ["כחול", "#3b82f6"],
  ["צהוב", "#facc15"],
  ["כתום", "#f97316"],
  ["סגול", "#8b5cf6"],
  ["אדום", "#ef4444"],
  ["אפור", "#94a3b8"],
  ["ורוד", "#ec4899"]
];

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function hashPassword(phone, password) {
  return crypto.createHash("sha256").update(`${phone}:${password}`).digest("hex");
}

// Israeli mobile numbers only, validated against the real numbering plan
// (not just digit count) via libphonenumber-js — a landline, an invalid or
// incomplete number, or a non-Israeli number are all rejected. Accepts
// local (05XXXXXXXX) or international (+9725XXXXXXXX) input; spaces,
// hyphens and parentheses are stripped first. Returns the E.164 form
// ("+972501234567") to store, or null if the input doesn't qualify.
function normalizeIsraeliMobile(raw) {
  const cleaned = String(raw || "").replace(/[\s\-()]/g, "");
  if (!cleaned) return null;
  const phoneNumber = parsePhoneNumberFromString(cleaned, "IL");
  if (!phoneNumber || !phoneNumber.isValid() || phoneNumber.country !== "IL") return null;
  const type = phoneNumber.getType();
  if (type !== "MOBILE" && type !== "FIXED_LINE_OR_MOBILE") return null;
  return phoneNumber.number;
}

// Accounts created before E.164 normalization kept whatever string was
// typed at signup (usually local "05XXXXXXXX"); accounts created after
// store E.164. Building every plausible stored form lets a phone lookup
// (login, duplicate checks) match either era without a data migration.
function phoneLookupCandidates(raw) {
  const trimmed = String(raw || "").trim();
  const candidates = new Set([trimmed]);
  const cleaned = trimmed.replace(/[\s\-()]/g, "");
  if (cleaned) candidates.add(cleaned);
  const e164 = normalizeIsraeliMobile(cleaned);
  if (e164) {
    candidates.add(e164);
    candidates.add(`0${e164.slice(4)}`); // +972XXXXXXXXX -> 0XXXXXXXXX
  }
  candidates.delete("");
  return [...candidates];
}

async function currentUser(req) {
  const id = req.header("x-user-id");
  if (!id) return null;
  // credits is deliberately not on publicPlayerSelect (shared with rosters
  // visible to teammates) — it's only ever added here, on the caller's own
  // private user record.
  const { rows } = await query(
    `SELECT ${publicPlayerSelect("players")}, players.org_id, players.credits FROM players WHERE id = $1 AND status = 'active'`,
    [id]
  );
  const user = rows[0];
  if (!user) return null;

  // Org-independent: a platform admin manages organizations themselves, not
  // any one org's data, so this is keyed by phone rather than derived from
  // any org membership below.
  const { rows: platformAdminRows } = await query(
    "SELECT 1 FROM platform_admins WHERE phone = $1",
    [user.phone]
  );
  user.is_platform_admin = platformAdminRows.length > 0;

  // Every org this player belongs to, with the role that applies there.
  const { rows: memberships } = await query(
    `SELECT m.org_id, m.role, m.status, m.is_monthly_member, m.is_senior_pitch,
            o.name AS org_name, o.slug AS org_slug
     FROM player_organizations m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.player_id = $1 AND m.status = 'active' AND o.is_active
     ORDER BY o.name`,
    [id]
  );
  user.organizations = memberships;

  // Active org: the one requested via header if the player is a member of it,
  // otherwise their home org. Never trust the header without checking membership.
  const requested = req.header("x-org-id");
  const match = requested && memberships.find((row) => row.org_id === requested);
  const active = match || memberships.find((row) => row.org_id === user.org_id) || memberships[0];
  if (active) {
    user.org_id = active.org_id;
    user.org_name = active.org_name;
    user.org_slug = active.org_slug;
    // The role that applies in the ACTIVE org governs this request.
    user.role = active.role;
    user.is_monthly_member = active.is_monthly_member;
    user.is_senior_pitch = active.is_senior_pitch;
  }
  return user;
}

// Guard: every admin-scoped resource must belong to the caller's active org.
async function assertOrgOwns(table, id, orgId) {
  const allowed = new Set([
    "matches", "players", "registrations", "pitches", "teams",
    "game_results", "goal_events", "match_standouts"
  ]);
  if (!allowed.has(table)) throw new Error(`unsupported table: ${table}`);
  const { rows } = await query(`SELECT 1 FROM ${table} WHERE id = $1 AND org_id = $2`, [id, orgId]);
  return rows.length > 0;
}

function requireRole(user, roles) {
  return user && roles.includes(user.role);
}

async function getActiveMatch(orgId) {
  const { rows } = await query(
    `SELECT * FROM matches
     WHERE org_id = $1
     ORDER BY (status <> 'stats_published') DESC, match_date DESC, starts_at DESC
     LIMIT 1`,
    [orgId]
  );
  return rows[0] || null;
}

async function getMatchById(matchId, orgId) {
  const { rows } = await query("SELECT * FROM matches WHERE id = $1 AND org_id = $2", [matchId, orgId]);
  return rows[0] || null;
}

async function getMatchBundle(matchId, includeRatings = false, orgId = null) {
  const [matchResult, registrations, pitches, teams, teamPlayers, games, goals, standouts] = await Promise.all([
    query(`SELECT * FROM matches WHERE id = $1 AND ($2::uuid IS NULL OR org_id = $2)`, [matchId, orgId]),
    query(
      `SELECT r.*,
        p.full_name AS player_name,
        p.phone AS player_phone,
        p.role AS player_role,
        p.status AS player_status,
        p.avatar_url AS player_avatar_url,
        p.is_monthly_member,
        p.is_senior_pitch
       FROM registrations r
       JOIN players p ON p.id = r.player_id
       WHERE r.match_id = $1 AND ($2::uuid IS NULL OR r.org_id = $2)
       ORDER BY r.requested_at ASC`,
      [matchId, orgId]
    ),
    query(`SELECT * FROM pitches WHERE match_id = $1 AND ($2::uuid IS NULL OR org_id = $2) ORDER BY pitch_number`, [matchId, orgId]),
    query(
      `SELECT t.*
       FROM teams t
       JOIN pitches p ON p.id = t.pitch_id
       WHERE p.match_id = $1 AND ($2::uuid IS NULL OR t.org_id = $2)
       ORDER BY p.pitch_number, t.sort_order`,
      [matchId, orgId]
    ),
    query(
      `SELECT tp.team_id, ${includeRatings ? "p.*, ROUND((p.attack * 0.5 + p.defense * 0.4 + p.fitness * 0.1)::numeric, 1) AS overall" : publicPlayerSelect("p")}
       FROM team_players tp
       JOIN players p ON p.id = tp.player_id
       JOIN teams t ON t.id = tp.team_id
       JOIN pitches pi ON pi.id = t.pitch_id
       WHERE pi.match_id = $1 AND ($2::uuid IS NULL OR tp.org_id = $2)
       ORDER BY p.full_name`,
      [matchId, orgId]
    ),
    query(
      `SELECT * FROM game_results
       WHERE pitch_id IN (SELECT id FROM pitches WHERE match_id = $1)
         AND ($2::uuid IS NULL OR org_id = $2)
       ORDER BY sort_order`,
      [matchId, orgId]
    ),
    query(
      `SELECT ge.*, scorer.full_name AS scorer_name, assist.full_name AS assist_name
       FROM goal_events ge
       JOIN players scorer ON scorer.id = ge.scorer_id
       LEFT JOIN players assist ON assist.id = ge.assist_id
       WHERE ge.game_id IN (
         SELECT gr.id FROM game_results gr
         JOIN pitches p ON p.id = gr.pitch_id
         WHERE p.match_id = $1
       ) AND ($2::uuid IS NULL OR ge.org_id = $2)`,
      [matchId, orgId]
    ),
    query(
      `SELECT ms.*, p.full_name, p.avatar_url
       FROM match_standouts ms
       JOIN players p ON p.id = ms.player_id
       WHERE ms.match_id = $1 AND ($2::uuid IS NULL OR ms.org_id = $2)
       ORDER BY ms.sort_order`,
      [matchId, orgId]
    )
  ]);

  const match = matchResult.rows[0];
  const teamMap = new Map(teams.rows.map((team) => [team.id, { ...team, players: [], stats: null }]));
  for (const player of teamPlayers.rows) {
    teamMap.get(player.team_id)?.players.push(player);
  }

  const pitchList = pitches.rows.map((pitch) => ({
    ...pitch,
    teams: teams.rows.filter((team) => team.pitch_id === pitch.id).map((team) => teamMap.get(team.id)),
    games: games.rows.filter((game) => game.pitch_id === pitch.id)
  }));

  const standings = computeStandings(pitchList, goals.rows);

  // Results are the admin's to publish. Until the match reaches
  // 'stats_published' a player's bundle carries no scores, standings, goals or
  // standouts — withheld here rather than merely hidden in the UI, so entering
  // a result mid-match never leaks it through the API.
  // Admin callers (includeRatings) always get the full picture.
  const resultsPublished = includeRatings || match?.status === "stats_published";

  // A flat "who's coming" list, ordered purely by when people registered —
  // usable during the week while registration is still open and no teams
  // have been built. "Playing" reuses rebalanceRegistrationQueue's own
  // verdict (status) rather than re-deriving capacity here — confirmation
  // happens in whole pitch-sized batches (each exactly players_per_team ×
  // teams_per_pitch), which can outrun approved_pitch_count while the group
  // is still filling up, so recomputing a single-pitch capacity here would
  // under-count who's actually confirmed. Only 'standby' is not playing;
  // 'payment_pending' still holds a seat, same as an unpaid one-timer does
  // everywhere else in the app.
  // Membership and payment status are an admin concern, never a fellow
  // player's — withheld from the wire entirely for non-admin callers, not
  // just hidden in the UI, same reasoning as resultsPublished above.
  const rosterPublished = includeRatings || match?.roster_published;
  const roster = rosterPublished
    ? registrations.rows
        .filter((registration) => !["cancelled", "not_attending"].includes(registration.status))
        .map((registration) => ({
          id: registration.id,
          player_id: registration.player_id,
          full_name: registration.player_name,
          avatar_url: registration.player_avatar_url,
          requested_at: registration.requested_at,
          playing: registration.status !== "standby",
          ...(includeRatings ? { is_monthly_member: registration.is_monthly_member, status: registration.status } : {})
        }))
    : null;

  return {
    match,
    roster,
    registrations: registrations.rows,
    pitches: pitchList.map((pitch) => ({
      ...pitch,
      games: resultsPublished ? pitch.games : [],
      teams: pitch.teams.map((team) => ({
        ...team,
        stats: resultsPublished ? standings.teamStats.get(team.id) : undefined
      })),
      standings: resultsPublished ? (standings.byPitch.get(pitch.id) || []) : []
    })),
    games: resultsPublished ? games.rows : [],
    goals: resultsPublished ? goals.rows : [],
    standouts: resultsPublished ? standouts.rows : []
  };
}

function computeStandings(pitches, goals) {
  const teamStats = new Map();
  const byPitch = new Map();
  const headToHead = new Map();

  for (const pitch of pitches) {
    for (const team of pitch.teams) {
      teamStats.set(team.id, { points: 0, wins: 0, goals_for: 0, goals_against: 0 });
    }
    for (const game of pitch.games) {
      const a = teamStats.get(game.team_a_id);
      const b = teamStats.get(game.team_b_id);
      a.goals_for += game.team_a_goals;
      a.goals_against += game.team_b_goals;
      b.goals_for += game.team_b_goals;
      b.goals_against += game.team_a_goals;

      if (game.team_a_goals > game.team_b_goals) {
        a.points += 3;
        a.wins += 1;
        headToHead.set(`${game.team_a_id}:${game.team_b_id}`, (headToHead.get(`${game.team_a_id}:${game.team_b_id}`) || 0) + 1);
      } else if (game.team_b_goals > game.team_a_goals) {
        b.points += 3;
        b.wins += 1;
        headToHead.set(`${game.team_b_id}:${game.team_a_id}`, (headToHead.get(`${game.team_b_id}:${game.team_a_id}`) || 0) + 1);
      } else {
        a.points += 1;
        b.points += 1;
      }
    }

    const ranked = pitch.teams
      .map((team) => ({ ...team, stats: teamStats.get(team.id) }))
      .sort((a, b) => {
        const score = b.stats.points - a.stats.points || b.stats.wins - a.stats.wins || b.stats.goals_for - a.stats.goals_for;
        if (score !== 0) return score;
        return (headToHead.get(`${b.id}:${a.id}`) || 0) - (headToHead.get(`${a.id}:${b.id}`) || 0);
      });
    byPitch.set(pitch.id, ranked);
  }

  for (const goal of goals) {
    const stats = teamStats.get(goal.team_id);
    if (stats) stats.goals_for = stats.goals_for;
  }

  return { teamStats, byPitch };
}

app.get("/api/health", asyncRoute(async (_req, res) => {
  const { rows } = await query("SELECT now() AS now");
  res.json({ ok: true, database: rows[0].now });
}));

// There is deliberately NO endpoint that lists organizations: clubs are never
// enumerated publicly, and the login page names none until a code resolves.
//
// Resolve a join code to the club it belongs to — the only way in. A wrong code
// is a flat 404, so this never reveals whether a club merely exists.
app.post("/api/organizations/lookup", asyncRoute(async (req, res) => {
  const code = String(req.body?.joinCode || "").trim();
  if (!code) return res.status(400).json({ error: "יש להזין קוד ארגון" });
  const { rows } = await query(
    `SELECT id, name, slug FROM organizations
     WHERE is_active AND upper(join_code) = upper($1)`,
    [code]
  );
  if (!rows[0]) return res.status(404).json({ error: "קוד ארגון לא נמצא" });
  const org = rows[0];
  // The signup form needs to know, up front, whether there's a second
  // (questionnaire) step to show — fetched here so it's one round trip
  // instead of a second unauthenticated lookup.
  const [settingsRow, questions] = await Promise.all([
    query("SELECT value FROM settings WHERE org_id = $1 AND key = 'registration_questionnaire_enabled'", [org.id]),
    query(
      `SELECT id, label, type, options, scale_min, scale_max, scale_min_label, scale_max_label, required
       FROM registration_questions WHERE org_id = $1 AND active ORDER BY sort_order, created_at`,
      [org.id]
    )
  ]);
  const questionnaireEnabled = settingsRow.rows[0]?.value === true;
  res.json({
    organization: org,
    questionnaireEnabled,
    questions: questionnaireEnabled ? questions.rows : []
  });
}));

app.post("/api/login", asyncRoute(async (req, res) => {
  const { phone, password, orgSlug } = req.body;
  // Phone is unique per org, so one number may exist in several organizations.
  // Older accounts were stored exactly as typed at signup (usually local
  // "05XXXXXXXX"); newer ones are stored normalized to E.164 — matching
  // every plausible stored form here means both eras log in the same way,
  // with no data migration. The password hash is salted with whatever
  // string actually ended up in players.phone for that row (not the raw
  // login input), since that's what was used to compute it at signup.
  const { rows } = await query(
    `SELECT ${publicPlayerSelect("players")}, players.password_hash, players.org_id,
            o.name AS org_name, o.slug AS org_slug
     FROM players
     JOIN organizations o ON o.id = players.org_id
     WHERE players.phone = ANY($1::text[]) AND o.is_active
     ORDER BY o.name`,
    [phoneLookupCandidates(phone)]
  );
  const candidates = rows.filter((row) => row.status === "active" && row.password_hash === hashPassword(row.phone, password || ""));

  // An explicit organization was chosen: the account must exist in THAT org.
  // Never silently fall back to a different one.
  if (orgSlug) {
    const match = candidates.find((row) => row.org_slug === orgSlug);
    if (!match) {
      return res.status(401).json({
        error: candidates.length
          ? "החשבון הזה לא קיים בארגון שנבחר"
          : "טלפון או סיסמה לא נכונים, או שהחשבון עדיין לא אושר"
      });
    }
    delete match.password_hash;
    await query(
      `INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id)
       VALUES ($1, $2, 'login', 'player', $2)`,
      [match.org_id, match.id]
    );
    return res.json({ user: match });
  }

  if (!candidates.length) {
    return res.status(401).json({ error: "טלפון או סיסמה לא נכונים, או שהחשבון עדיין לא אושר" });
  }

  // Same phone+password valid in several clubs and no choice made — ask which,
  // rather than guessing and signing them into the wrong one. The login screen
  // always sends the org it unlocked, so this is a safety net for other API
  // callers rather than a path that UI reaches.
  if (candidates.length > 1) {
    return res.status(409).json({
      error: "המספר הזה רשום בכמה ארגונים — יש לבחור ארגון",
      needsOrg: true,
      organizations: candidates.map((row) => ({ org_id: row.org_id, name: row.org_name, slug: row.org_slug }))
    });
  }

  const user = candidates[0];
  delete user.password_hash;
  await query(
    `INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id)
     VALUES ($1, $2, 'login', 'player', $2)`,
    [user.org_id, user.id]
  );
  res.json({ user });
}));

app.get("/api/bootstrap", asyncRoute(async (_req, res) => {
  const user = await currentUser(_req);
  if (!user) return res.status(401).json({ error: "נדרשת התחברות" });
  const orgId = user.org_id;
  const [players, settings, activeMatch] = await Promise.all([
    query(
      `SELECT ${publicPlayerSelect("players")} FROM players
       WHERE org_id = $1 AND status IN ('active', 'pending')
       ORDER BY role DESC, full_name`,
      [orgId]
    ),
    query("SELECT key, value FROM settings WHERE org_id = $1", [orgId]),
    getActiveMatch(orgId)
  ]);
  const bundle = activeMatch ? await getMatchBundle(activeMatch.id, false, orgId) : null;
  res.json({
    user,
    organization: { id: orgId, name: user.org_name, slug: user.org_slug },
    organizations: user.organizations || [],
    players: players.rows,
    settings: Object.fromEntries(settings.rows.map((row) => [row.key, row.value])),
    activeMatch: bundle
  });
}));

// Platform admin: manages organizations themselves, never their data. Gated
// on is_platform_admin (see currentUser), never on any org role — being a
// platform admin does not by itself make someone an admin of any org.
app.use("/api/platform", asyncRoute(async (req, res, next) => {
  const user = await currentUser(req);
  if (!user?.is_platform_admin) return res.status(403).json({ error: "אין הרשאת מנהל פלטפורמה" });
  req.user = user;
  next();
}));

function slugify(name) {
  const base = String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // A Hebrew-only name (the common case) strips to nothing — fall back to a
  // short random slug rather than every such org colliding on the same base.
  return base || `club-${crypto.randomBytes(3).toString("hex")}`;
}

async function uniqueSlug(base) {
  let slug = base;
  let suffix = 2;
  while ((await query("SELECT 1 FROM organizations WHERE slug = $1", [slug])).rows.length) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  return slug;
}

// No O/0/I/1 — survives being read aloud or copied by hand. Same alphabet as
// db/migrations/003_org_join_codes.sql, generated in JS instead of SQL here.
const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randomJoinCode() {
  return Array.from({ length: 6 }, () => JOIN_CODE_ALPHABET[crypto.randomInt(JOIN_CODE_ALPHABET.length)]).join("");
}

async function uniqueJoinCode() {
  let code = randomJoinCode();
  while ((await query("SELECT 1 FROM organizations WHERE upper(join_code) = $1", [code])).rows.length) {
    code = randomJoinCode();
  }
  return code;
}

app.get("/api/platform/organizations", asyncRoute(async (_req, res) => {
  const { rows } = await query(
    `SELECT o.id, o.name, o.slug, o.join_code, o.is_active, o.created_at,
       (SELECT COUNT(*)::int FROM players p WHERE p.org_id = o.id) AS player_count,
       COALESCE(
         (SELECT json_agg(json_build_object('id', a.player_id, 'full_name', ap.full_name, 'phone', ap.phone) ORDER BY ap.full_name)
          FROM player_organizations a
          JOIN players ap ON ap.id = a.player_id
          WHERE a.org_id = o.id AND a.role = 'admin' AND a.status = 'active'),
         '[]'
       ) AS admins
     FROM organizations o
     ORDER BY o.created_at DESC`
  );
  res.json({ organizations: rows });
}));

app.post("/api/platform/organizations", asyncRoute(async (req, res) => {
  const { name, slug, joinCode } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: "יש להזין שם ארגון" });
  const resolvedSlug = await uniqueSlug(slug ? slugify(slug) : slugify(name));
  const resolvedCode = joinCode ? String(joinCode).trim().toUpperCase() : await uniqueJoinCode();
  const { rows } = await query(
    `INSERT INTO organizations (name, slug, join_code) VALUES ($1, $2, $3) RETURNING *`,
    [String(name).trim(), resolvedSlug, resolvedCode]
  );
  await query(
    `INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after_value)
     VALUES ($1, $2, 'platform_create_org', 'organization', $1, $3)`,
    [rows[0].id, req.user.id, JSON.stringify(rows[0])]
  );
  res.status(201).json({ organization: rows[0] });
}));

app.post("/api/platform/organizations/:orgId/admins", asyncRoute(async (req, res) => {
  const { orgId } = req.params;
  const { phone, fullName } = req.body;
  if (!phone || !String(phone).trim()) return res.status(400).json({ error: "יש להזין טלפון" });
  const { rows: orgRows } = await query("SELECT id FROM organizations WHERE id = $1", [orgId]);
  if (!orgRows[0]) return res.status(404).json({ error: "ארגון לא נמצא" });

  // Look across every org, not just this one — an admin being assigned here
  // may already be a player somewhere else, and that is the same person.
  const { rows: existing } = await query("SELECT id, full_name FROM players WHERE phone = $1 LIMIT 1", [phone]);

  let playerId;
  let playerName;
  if (existing[0]) {
    playerId = existing[0].id;
    playerName = existing[0].full_name;
  } else {
    if (!fullName || !String(fullName).trim()) {
      return res.status(400).json({ error: "שחקן עם הטלפון הזה לא נמצא — יש להזין שם מלא ליצירת אדמין חדש" });
    }
    const { rows: created } = await query(
      `INSERT INTO players (org_id, full_name, phone, password_hash, status, role, avatar_url)
       VALUES ($1, $2, $3, $4, 'active', 'admin', $5)
       RETURNING id, full_name`,
      [orgId, String(fullName).trim(), phone, hashPassword(phone, "123456"), `https://i.pravatar.cc/120?u=${encodeURIComponent(phone)}`]
    );
    playerId = created[0].id;
    playerName = created[0].full_name;
  }

  await query(
    `INSERT INTO player_organizations (player_id, org_id, role, status)
     VALUES ($1, $2, 'admin', 'active')
     ON CONFLICT (player_id, org_id) DO UPDATE SET role = 'admin', status = 'active'`,
    [playerId, orgId]
  );
  await query(
    `INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after_value)
     VALUES ($1, $2, 'platform_assign_admin', 'player', $3, $4)`,
    [orgId, req.user.id, playerId, JSON.stringify({ phone, fullName: playerName })]
  );
  res.status(201).json({ playerId, fullName: playerName });
}));

app.use("/api/admin", asyncRoute(async (req, res, next) => {
  const user = await currentUser(req);
  if (!requireRole(user, ["admin", "stats_admin"])) return res.status(403).json({ error: "אין הרשאת אדמין" });
  req.user = user;
  next();
}));

app.get("/api/admin", asyncRoute(async (_req, res) => {
  const orgId = _req.user.org_id;
  const requestedMatchId = _req.query.matchId;
  const selectedMatch = requestedMatchId
    ? await getMatchById(requestedMatchId, orgId)
    : await getActiveMatch(orgId);
  if (requestedMatchId && !selectedMatch) return res.status(404).json({ error: "מחזור לא נמצא" });
  if (selectedMatch) await rebalanceRegistrationQueue(selectedMatch.id);
  const [pendingPlayers, payments, cancellations, players, audit, fixtures, pendingJoinRequests, pendingCancellations, pendingPayments, settings, orgRow, registrationQuestions] = await Promise.all([
    query("SELECT COUNT(*)::int AS count FROM players WHERE org_id = $1 AND status = 'pending'", [orgId]),
    query("SELECT COUNT(*)::int AS count FROM registrations WHERE org_id = $1 AND status = 'payment_pending'", [orgId]),
    query("SELECT COUNT(*)::int AS count FROM registrations WHERE org_id = $1 AND status = 'cancelled' AND cancellation_review IS NULL", [orgId]),
    query(`SELECT *, ROUND((attack * 0.5 + defense * 0.4 + fitness * 0.1)::numeric, 1) AS overall FROM players WHERE org_id = $1 ORDER BY status, full_name`, [orgId]),
    query(`SELECT a.*, p.full_name AS actor_name FROM audit_log a LEFT JOIN players p ON p.id = a.actor_id WHERE a.org_id = $1 ORDER BY a.created_at DESC LIMIT 30`, [orgId]),
    query(
      `SELECT m.*,
        COUNT(DISTINCT pi.id)::int AS pitch_count,
        COUNT(DISTINCT t.id)::int AS team_count,
        COUNT(DISTINCT r.id) FILTER (WHERE r.status IN ('attending', 'payment_pending', 'standby'))::int AS registration_count
       FROM matches m
       LEFT JOIN pitches pi ON pi.match_id = m.id
       LEFT JOIN teams t ON t.pitch_id = pi.id
       LEFT JOIN registrations r ON r.match_id = m.id
       WHERE m.org_id = $1
       GROUP BY m.id
       ORDER BY m.match_date DESC, m.starts_at DESC`,
      [orgId]
    ),
    // The actual join requests awaiting approval — a count alone gave the admin
    // no way to act on them.
    query(
      `SELECT id, full_name, phone, avatar_url, admin_note, created_at
       FROM players
       WHERE org_id = $1 AND status = 'pending'
       ORDER BY created_at DESC`,
      [orgId]
    ),
    // The actual cancellation requests still awaiting an admin decision, across
    // every fixture — the dashboard count alone gave no way to act on them.
    query(
      `SELECT r.id, r.match_id, r.player_id, r.cancellation_reason, r.requested_at,
              p.full_name AS player_name, p.avatar_url AS player_avatar_url,
              p.is_monthly_member,
              m.title AS match_title, m.match_date
       FROM registrations r
       JOIN players p ON p.id = r.player_id
       JOIN matches m ON m.id = r.match_id
       WHERE r.org_id = $1 AND r.status = 'cancelled' AND r.cancellation_review IS NULL
       ORDER BY m.match_date DESC, r.requested_at DESC`,
      [orgId]
    ),
    // The actual one-timers waiting on payment, across every fixture — the
    // dashboard count alone gave no way to confirm them without switching tabs.
    query(
      `SELECT r.id, r.match_id, r.player_id, r.requested_at,
              p.full_name AS player_name, p.avatar_url AS player_avatar_url,
              m.title AS match_title, m.match_date, m.one_time_price, m.payment_link
       FROM registrations r
       JOIN players p ON p.id = r.player_id
       JOIN matches m ON m.id = r.match_id
       WHERE r.org_id = $1 AND r.status = 'payment_pending'
       ORDER BY m.match_date DESC, r.requested_at ASC`,
      [orgId]
    ),
    query("SELECT key, value FROM settings WHERE org_id = $1", [orgId]),
    // join_code isn't on the session user (currentUser only selects public
    // player fields) — needed here so an org admin can share their own
    // invite link without a platform admin having to hand it to them.
    query("SELECT join_code FROM organizations WHERE id = $1", [orgId]),
    query("SELECT * FROM registration_questions WHERE org_id = $1 ORDER BY sort_order, created_at", [orgId])
  ]);
  // Teams left short of players_per_team — usually because someone cancelled
  // after the lineups were built. The admin needs to slot in a replacement.
  const understaffed = [];
  // Only meaningful once lineups have been built — an empty draft is not "short".
  const lineupsExist = ["teams_draft", "teams_published", "finished", "stats_published"]
    .includes(selectedMatch?.status);
  if (selectedMatch && lineupsExist) {
    const perTeam = Number(selectedMatch.players_per_team || 5);
    const { rows: teamCounts } = await query(
      `SELECT t.id AS team_id, t.color_name, t.color_hex,
              p.id AS pitch_id, p.label AS pitch_label,
              COUNT(tp.player_id)::int AS player_count
       FROM teams t
       JOIN pitches p ON p.id = t.pitch_id
       LEFT JOIN team_players tp ON tp.team_id = t.id
       WHERE p.match_id = $1 AND t.org_id = $2
       GROUP BY t.id, t.color_name, t.color_hex, p.id, p.label, t.sort_order
       ORDER BY p.pitch_number, t.sort_order`,
      [selectedMatch.id, orgId]
    );
    for (const team of teamCounts) {
      if (team.player_count < perTeam) {
        understaffed.push({ ...team, needed: perTeam - team.player_count, players_per_team: perTeam });
      }
    }
  }

  res.json({
    organization: { id: orgId, name: _req.user.org_name, slug: _req.user.org_slug, join_code: orgRow.rows[0]?.join_code },
    pendingJoinRequests: pendingJoinRequests.rows,
    pendingCancellations: pendingCancellations.rows,
    pendingPayments: pendingPayments.rows,
    understaffedTeams: understaffed,
    activeMatch: selectedMatch ? await getMatchBundle(selectedMatch.id, true, orgId) : null,
    fixtures: fixtures.rows,
    metrics: {
      pendingPlayers: pendingPlayers.rows[0].count,
      payments: payments.rows[0].count,
      cancellations: cancellations.rows[0].count
    },
    players: players.rows,
    audit: audit.rows,
    settings: Object.fromEntries(settings.rows.map((row) => [row.key, row.value])),
    registrationQuestions: registrationQuestions.rows
  });
}));

// Freeform org-level preferences (settings table), keyed by name — e.g.
// whether players can tap another player to see their stats. Upserts so the
// caller never needs to know whether a row already exists.
app.patch("/api/admin/settings/:key", asyncRoute(async (req, res) => {
  const { key } = req.params;
  const { value } = req.body;
  const orgId = req.user.org_id;
  if (value === undefined) return res.status(400).json({ error: "חסר ערך" });
  await query(
    `INSERT INTO settings (org_id, key, value) VALUES ($1, $2, $3)
     ON CONFLICT (org_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [orgId, key, JSON.stringify(value)]
  );
  res.json({ key, value });
}));

const REGISTRATION_QUESTION_TYPES = ["scale", "dropdown", "radio", "multiselect", "text"];

// Custom questions an admin defines for the signup form's second step (see
// registration_questionnaire_enabled in settings for the on/off switch).
app.get("/api/admin/registration-questions", asyncRoute(async (req, res) => {
  const { rows } = await query(
    "SELECT * FROM registration_questions WHERE org_id = $1 ORDER BY sort_order, created_at",
    [req.user.org_id]
  );
  res.json(rows);
}));

app.post("/api/admin/registration-questions", asyncRoute(async (req, res) => {
  const { label, type, options, required, scaleMin, scaleMax, scaleMinLabel, scaleMaxLabel } = req.body;
  const orgId = req.user.org_id;
  if (!label || !String(label).trim()) return res.status(400).json({ error: "יש להזין טקסט לשאלה" });
  if (!REGISTRATION_QUESTION_TYPES.includes(type)) return res.status(400).json({ error: "סוג שאלה לא תקין" });
  const isScale = type === "scale";
  const cleanOptions = Array.isArray(options) ? options.map((item) => String(item || "").trim()).filter(Boolean) : [];
  const { rows: maxRows } = await query(
    "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM registration_questions WHERE org_id = $1",
    [orgId]
  );
  const { rows } = await query(
    `INSERT INTO registration_questions
      (org_id, label, type, options, scale_min, scale_max, scale_min_label, scale_max_label, required, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      orgId, label.trim(), type, JSON.stringify(cleanOptions),
      isScale ? Number(scaleMin ?? 1) : null,
      isScale ? Number(scaleMax ?? 5) : null,
      isScale ? (scaleMinLabel || null) : null,
      isScale ? (scaleMaxLabel || null) : null,
      Boolean(required),
      maxRows[0].next
    ]
  );
  await query(
    `INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after_value)
     VALUES ($1, $2, 'admin_add_registration_question', 'registration_question', $3, $4)`,
    [orgId, req.user.id, rows[0].id, JSON.stringify(rows[0])]
  );
  res.status(201).json(rows[0]);
}));

app.patch("/api/admin/registration-questions/:id", asyncRoute(async (req, res) => {
  const { id } = req.params;
  const orgId = req.user.org_id;
  const { label, type, options, required, active, scaleMin, scaleMax, scaleMinLabel, scaleMaxLabel } = req.body;
  if (type !== undefined && !REGISTRATION_QUESTION_TYPES.includes(type)) {
    return res.status(400).json({ error: "סוג שאלה לא תקין" });
  }
  const { rows: before } = await query("SELECT * FROM registration_questions WHERE id = $1 AND org_id = $2", [id, orgId]);
  if (!before[0]) return res.status(404).json({ error: "שאלה לא נמצאה" });
  const cleanOptions = options !== undefined
    ? JSON.stringify(Array.isArray(options) ? options.map((item) => String(item || "").trim()).filter(Boolean) : [])
    : null;
  const { rows } = await query(
    `UPDATE registration_questions SET
      label = COALESCE($3, label),
      type = COALESCE($4::registration_question_type, type),
      options = COALESCE($5::jsonb, options),
      scale_min = COALESCE($6, scale_min),
      scale_max = COALESCE($7, scale_max),
      scale_min_label = COALESCE($8, scale_min_label),
      scale_max_label = COALESCE($9, scale_max_label),
      required = COALESCE($10, required),
      active = COALESCE($11, active)
     WHERE id = $1 AND org_id = $2
     RETURNING *`,
    [
      id, orgId,
      label != null ? String(label).trim() : null,
      type || null,
      cleanOptions,
      scaleMin ?? null, scaleMax ?? null, scaleMinLabel ?? null, scaleMaxLabel ?? null,
      required ?? null, active ?? null
    ]
  );
  await query(
    `INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, before_value, after_value)
     VALUES ($1, $2, 'admin_update_registration_question', 'registration_question', $3, $4, $5)`,
    [orgId, req.user.id, id, JSON.stringify(before[0]), JSON.stringify(rows[0])]
  );
  res.json(rows[0]);
}));

app.delete("/api/admin/registration-questions/:id", asyncRoute(async (req, res) => {
  const { id } = req.params;
  const orgId = req.user.org_id;
  const { rows: deleted } = await query(
    "DELETE FROM registration_questions WHERE id = $1 AND org_id = $2 RETURNING *",
    [id, orgId]
  );
  if (!deleted[0]) return res.status(404).json({ error: "שאלה לא נמצאה" });
  await query(
    `INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, before_value)
     VALUES ($1, $2, 'admin_delete_registration_question', 'registration_question', $3, $4)`,
    [orgId, req.user.id, id, JSON.stringify(deleted[0])]
  );
  res.json({ ok: true });
}));

// Swap this question's position with its neighbor — the list is short
// (a handful of questions per org), so a full reorder payload is overkill.
app.post("/api/admin/registration-questions/:id/move", asyncRoute(async (req, res) => {
  const { id } = req.params;
  const { direction } = req.body;
  const orgId = req.user.org_id;
  const { rows } = await query(
    "SELECT id, sort_order FROM registration_questions WHERE org_id = $1 ORDER BY sort_order, created_at",
    [orgId]
  );
  const index = rows.findIndex((row) => row.id === id);
  if (index === -1) return res.status(404).json({ error: "שאלה לא נמצאה" });
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith >= 0 && swapWith < rows.length) {
    const a = rows[index];
    const b = rows[swapWith];
    await query("UPDATE registration_questions SET sort_order = $1 WHERE id = $2", [b.sort_order, a.id]);
    await query("UPDATE registration_questions SET sort_order = $1 WHERE id = $2", [a.sort_order, b.id]);
  }
  const { rows: updated } = await query(
    "SELECT * FROM registration_questions WHERE org_id = $1 ORDER BY sort_order, created_at",
    [orgId]
  );
  res.json(updated);
}));

// What a player answered on the signup questionnaire — shown on their
// profile alongside the freeform admin notes.
app.get("/api/admin/players/:playerId/registration-answers", asyncRoute(async (req, res) => {
  const { playerId } = req.params;
  const orgId = req.user.org_id;
  const { rows } = await query(
    `SELECT q.id AS question_id, q.label, q.type, a.value, a.value_list
     FROM registration_answers a
     JOIN registration_questions q ON q.id = a.question_id
     WHERE a.player_id = $1 AND a.org_id = $2
     ORDER BY q.sort_order`,
    [playerId, orgId]
  );
  res.json(rows);
}));

// Unauthenticated, checked between the signup form's two steps: no point
// walking someone through the (possibly long) questionnaire only to reject
// their phone number at the very end.
app.post("/api/players/check-phone", asyncRoute(async (req, res) => {
  const phone = String(req.body?.phone || "").trim();
  const joinCode = String(req.body?.joinCode || "").trim();
  if (!phone || !joinCode) return res.status(400).json({ error: "חסרים פרטים" });
  if (!normalizeIsraeliMobile(phone)) {
    return res.status(400).json({ error: "מספר טלפון לא תקין — יש להזין מספר סלולרי ישראלי תקין" });
  }
  const { rows: orgRows } = await query(
    "SELECT id FROM organizations WHERE is_active AND upper(join_code) = upper($1)",
    [joinCode]
  );
  const org = orgRows[0];
  if (!org) return res.status(404).json({ error: "ארגון לא נמצא" });
  const { rows } = await query(
    "SELECT 1 FROM players WHERE org_id = $1 AND phone = ANY($2::text[])",
    [org.id, phoneLookupCandidates(phone)]
  );
  res.json({ exists: rows.length > 0 });
}));

app.post("/api/players", asyncRoute(async (req, res) => {
  const { fullName, phone, password, avatarUrl, referral, orgSlug, joinCode, answers } = req.body;
  if (!fullName || !phone) {
    return res.status(400).json({ error: "שם וטלפון הם שדות חובה" });
  }
  // The client already blocks this, but that's UI, not enforcement. Only a
  // real Israeli mobile number is accepted — not just any 10 digits, and
  // not a landline — and it's normalized to E.164 for storage from here on.
  const normalizedPhone = normalizeIsraeliMobile(phone);
  if (!normalizedPhone) {
    return res.status(400).json({ error: "מספר טלפון לא תקין — יש להזין מספר סלולרי ישראלי תקין" });
  }
  // Unauthenticated request. Slugs are guessable, so the join code — not the
  // slug — is what proves the applicant was actually invited to this club.
  const supplied = String(joinCode || "").trim();
  if (!supplied) return res.status(400).json({ error: "יש להזין קוד ארגון" });
  const { rows: orgRows } = await query(
    `SELECT id FROM organizations
     WHERE is_active AND upper(join_code) = upper($1)
       AND ($2::text IS NULL OR slug = $2)`,
    [supplied, orgSlug || null]
  );
  const org = orgRows[0];
  if (!org) return res.status(404).json({ error: "ארגון לא נמצא" });
  const orgId = org.id;

  const { rows: existing } = await query(
    "SELECT 1 FROM players WHERE org_id = $1 AND phone = ANY($2::text[])",
    [orgId, phoneLookupCandidates(phone)]
  );
  if (existing.length) return res.status(409).json({ error: "מספר הטלפון כבר רשום בארגון הזה" });

  // Validate the questionnaire (if any) before creating anything — a
  // missing required answer should never leave behind a half-created player.
  const { rows: activeQuestions } = await query(
    "SELECT * FROM registration_questions WHERE org_id = $1 AND active ORDER BY sort_order, created_at",
    [orgId]
  );
  const answerMap = answers && typeof answers === "object" ? answers : {};
  const isAnswerEmpty = (question) => {
    const value = answerMap[question.id];
    return question.type === "multiselect"
      ? !Array.isArray(value) || value.length === 0
      : value === undefined || value === null || String(value).trim() === "";
  };
  for (const question of activeQuestions) {
    if (question.required && isAnswerEmpty(question)) {
      return res.status(400).json({ error: `יש למלא את השאלה: ${question.label}` });
    }
  }

  const { rows } = await query(
    `INSERT INTO players (org_id, full_name, phone, password_hash, avatar_url, status, tags, admin_note)
     VALUES ($1, $2, $3, $4, $5, 'pending', ARRAY['חדש'], $6)
     RETURNING ${playerFields}`,
    [orgId, fullName, normalizedPhone, hashPassword(normalizedPhone, password || "123456"), avatarUrl || `https://i.pravatar.cc/120?u=${encodeURIComponent(normalizedPhone)}`, referral ? `דרך ${referral}` : null]
  );
  const playerId = rows[0].id;
  // Pending membership in that org; an admin approves it.
  await query(
    `INSERT INTO player_organizations (player_id, org_id, role, status)
     VALUES ($1, $2, 'player', 'pending')
     ON CONFLICT (player_id, org_id) DO NOTHING`,
    [playerId, orgId]
  );
  for (const question of activeQuestions) {
    if (isAnswerEmpty(question)) continue;
    const value = answerMap[question.id];
    if (question.type === "multiselect") {
      await query(
        `INSERT INTO registration_answers (org_id, player_id, question_id, value_list) VALUES ($1, $2, $3, $4)`,
        [orgId, playerId, question.id, value]
      );
    } else {
      await query(
        `INSERT INTO registration_answers (org_id, player_id, question_id, value) VALUES ($1, $2, $3, $4)`,
        [orgId, playerId, question.id, String(value)]
      );
    }
  }
  await query(
    `INSERT INTO audit_log (org_id, action, entity_type, entity_id, after_value)
     VALUES ($1, 'player_signup', 'player', $2, $3)`,
    [orgId, playerId, JSON.stringify({ fullName, phone })]
  );
  res.status(201).json(rows[0]);
}));

// Self-service: a player editing their own name/photo. Deliberately narrow —
// role, status, ratings and membership stay admin-only via the /api/admin
// route below, this one only ever touches the caller's own row.
app.patch("/api/players/me", asyncRoute(async (req, res) => {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "נדרשת התחברות" });
  const { full_name, avatar_url } = req.body;
  const { rows } = await query(
    `UPDATE players SET
      full_name = COALESCE($2, full_name),
      avatar_url = COALESCE($3, avatar_url)
     WHERE id = $1
     RETURNING ${playerFields}`,
    [user.id, full_name || null, avatar_url || null]
  );
  await query(
    `INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after_value)
     VALUES ($1, $2, 'player_update_profile', 'player', $2, $3)`,
    [user.org_id, user.id, JSON.stringify({ full_name, avatar_url })]
  );
  res.json(rows[0]);
}));

app.patch("/api/admin/players/:playerId", asyncRoute(async (req, res) => {
  const { playerId } = req.params;
  const {
    full_name,
    phone,
    role,
    status,
    is_monthly_member,
    is_senior_pitch,
    attack,
    defense,
    fitness,
    admin_note,
    credits
  } = req.body;
  const orgId = req.user.org_id;
  const { rows: before } = await query("SELECT * FROM players WHERE id = $1 AND org_id = $2", [playerId, orgId]);
  if (!before[0]) return res.status(404).json({ error: "שחקן לא נמצא" });
  // Only validate when the phone is actually changing — the players list's
  // inline editor resubmits every field (including an untouched phone) on
  // every save, and a pre-existing number that predates this validation
  // shouldn't block edits to unrelated fields.
  let normalizedPhone = phone;
  if (phone !== undefined && phone !== null && phone !== before[0].phone) {
    normalizedPhone = normalizeIsraeliMobile(phone);
    if (!normalizedPhone) {
      return res.status(400).json({ error: "מספר טלפון לא תקין — יש להזין מספר סלולרי ישראלי תקין" });
    }
  }
  const { rows } = await query(
    `UPDATE players SET
       full_name = COALESCE($2, full_name),
       phone = COALESCE($3, phone),
       role = COALESCE($4::player_role, role),
       status = COALESCE($5::player_status, status),
       is_monthly_member = COALESCE($6, is_monthly_member),
       is_senior_pitch = COALESCE($7, is_senior_pitch),
       attack = COALESCE($8, attack),
       defense = COALESCE($9, defense),
       fitness = COALESCE($10, fitness),
       admin_note = COALESCE($11, admin_note),
       credits = GREATEST(0, COALESCE($13, credits))
     WHERE id = $1 AND org_id = $12
     RETURNING *`,
    [playerId, full_name, normalizedPhone, role, status, is_monthly_member, is_senior_pitch, attack, defense, fitness, admin_note, orgId, credits]
  );
  // Keep the membership row in step with whatever THIS request actually
  // changed — each COALESCEs against its own table's current value, never
  // the other table's. Deriving these from the just-updated `players` row
  // (as this used to) meant any edit that didn't touch role/status still
  // pushed players' possibly-stale value into player_organizations,
  // silently reverting an org-scoped change (e.g. an admin grant) made
  // through a path that only ever touched one of the two tables.
  await query(
    `INSERT INTO player_organizations (player_id, org_id, role, status, is_monthly_member, is_senior_pitch)
     VALUES ($1, $2, COALESCE($3::player_role, 'player'), COALESCE($4::player_status, 'active'), COALESCE($5, false), COALESCE($6, false))
     ON CONFLICT (player_id, org_id) DO UPDATE SET
       role = COALESCE($3::player_role, player_organizations.role),
       status = COALESCE($4::player_status, player_organizations.status),
       is_monthly_member = COALESCE($5, player_organizations.is_monthly_member),
       is_senior_pitch = COALESCE($6, player_organizations.is_senior_pitch)`,
    [playerId, orgId, role, status, is_monthly_member, is_senior_pitch]
  );
  await query(
    `INSERT INTO audit_log (org_id, action, entity_type, entity_id, before_value, after_value)
     VALUES ($1, 'admin_update_player', 'player', $2, $3, $4)`,
    [orgId, playerId, JSON.stringify(before[0]), JSON.stringify(rows[0])]
  );
  res.json(rows[0]);
}));

// Append-only log an admin can add to freely — distinct from the single
// admin_note column above, which doubles as the signup-time referral text.
app.get("/api/admin/players/:playerId/notes", asyncRoute(async (req, res) => {
  const { playerId } = req.params;
  const orgId = req.user.org_id;
  const { rows } = await query(
    `SELECT n.*, p.full_name AS author_name
     FROM player_notes n
     LEFT JOIN players p ON p.id = n.author_id
     WHERE n.player_id = $1 AND n.org_id = $2
     ORDER BY n.created_at DESC`,
    [playerId, orgId]
  );
  res.json(rows);
}));

app.post("/api/admin/players/:playerId/notes", asyncRoute(async (req, res) => {
  const { playerId } = req.params;
  const { body } = req.body;
  const orgId = req.user.org_id;
  if (!body || !body.trim()) return res.status(400).json({ error: "יש להזין תוכן להערה" });
  const { rows: playerRows } = await query("SELECT 1 FROM players WHERE id = $1 AND org_id = $2", [playerId, orgId]);
  if (!playerRows[0]) return res.status(404).json({ error: "שחקן לא נמצא" });
  const { rows } = await query(
    `INSERT INTO player_notes (org_id, player_id, author_id, body)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [orgId, playerId, req.user.id, body.trim()]
  );
  await query(
    `INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after_value)
     VALUES ($1, $2, 'admin_add_player_note', 'player', $3, $4)`,
    [orgId, req.user.id, playerId, JSON.stringify({ body: body.trim() })]
  );
  res.status(201).json({ ...rows[0], author_name: req.user.full_name });
}));

app.post("/api/admin/matches", asyncRoute(async (req, res) => {
  const { title, matchDate, startsAt, location, pitchCount, teamsPerPitch, playersPerTeam, oneTimePrice, paymentLink, banner } = req.body;
  const orgId = req.user.org_id;
  const { rows } = await query(
    `INSERT INTO matches (org_id, title, match_date, starts_at, location, approved_pitch_count, teams_per_pitch, players_per_team, one_time_price, payment_link, banner, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'draft')
     RETURNING *`,
    [orgId, title || "מחזור חדש", matchDate, startsAt || "21:30", location || "", Number(pitchCount || 0), teamsPerPitch || 3, playersPerTeam || 5, oneTimePrice || 39, paymentLink || null, banner || null]
  );
  await setupPitches(rows[0].id, rows[0].approved_pitch_count, rows[0].teams_per_pitch, orgId);
  await query(
    `INSERT INTO audit_log (org_id, action, entity_type, entity_id, after_value)
     VALUES ($1, 'admin_create_match', 'match', $2, $3)`,
    [orgId, rows[0].id, JSON.stringify(rows[0])]
  );
  res.status(201).json(await getMatchBundle(rows[0].id, true, orgId));
}));

app.patch("/api/admin/matches/:matchId", asyncRoute(async (req, res) => {
  const { matchId } = req.params;
  const { title, match_date, starts_at, location, status, members_can_register, one_timers_can_register, roster_published, approved_pitch_count, teams_per_pitch, players_per_team, one_time_price, payment_link, banner } = req.body;
  const orgId = req.user.org_id;
  const { rows: before } = await query("SELECT * FROM matches WHERE id = $1 AND org_id = $2", [matchId, orgId]);
  if (!before[0]) return res.status(404).json({ error: "משחק לא נמצא" });
  const { rows } = await query(
    `UPDATE matches SET
      title = COALESCE($2, title),
      match_date = COALESCE($3, match_date),
      starts_at = COALESCE($4, starts_at),
      location = COALESCE($5, location),
      status = COALESCE($6::match_status, status),
      -- Independent of status: an admin may open either audience at any stage.
      members_can_register = COALESCE($7::boolean, members_can_register),
      one_timers_can_register = COALESCE($8::boolean, one_timers_can_register),
      roster_published = COALESCE($9::boolean, roster_published),
      approved_pitch_count = COALESCE($10, approved_pitch_count),
      teams_per_pitch = COALESCE($11, teams_per_pitch),
      players_per_team = COALESCE($12, players_per_team),
      one_time_price = COALESCE($13, one_time_price),
      payment_link = COALESCE($14, payment_link),
      banner = COALESCE($15, banner)
     WHERE id = $1 AND org_id = $16
     RETURNING *`,
    [matchId, title, match_date, starts_at, location, status,
     members_can_register ?? null, one_timers_can_register ?? null, roster_published ?? null,
     approved_pitch_count, teams_per_pitch, players_per_team, one_time_price, payment_link, banner, orgId]
  );
  if (approved_pitch_count || teams_per_pitch) await setupPitches(matchId, rows[0].approved_pitch_count, rows[0].teams_per_pitch, orgId);
  if (teams_per_pitch || players_per_team) await rebalanceRegistrationQueue(matchId);
  await query(
    `INSERT INTO audit_log (org_id, action, entity_type, entity_id, before_value, after_value)
     VALUES ($1, 'admin_update_match', 'match', $2, $3, $4)`,
    [orgId, matchId, JSON.stringify(before[0]), JSON.stringify(rows[0])]
  );
  res.json(await getMatchBundle(matchId, true, orgId));
}));

// An admin picking anyone off the full roster and dropping them straight
// onto this fixture — bypassing members_can_register / one_timers_can_register
// entirely (those gate the player-facing self-serve endpoint, not this one)
// and reactivating a previously cancelled registration if one exists.
app.post("/api/admin/matches/:matchId/registrations", asyncRoute(async (req, res) => {
  const { matchId } = req.params;
  const { playerId, status } = req.body;
  const orgId = req.user.org_id;
  if (!playerId) return res.status(400).json({ error: "לא נבחר שחקן" });
  const nextStatus = status === "standby" ? "standby" : "attending";
  const { rows: matchRows } = await query("SELECT id FROM matches WHERE id = $1 AND org_id = $2", [matchId, orgId]);
  if (!matchRows[0]) return res.status(404).json({ error: "מחזור לא נמצא" });
  const { rows: playerRows } = await query(
    "SELECT id, is_monthly_member, credits FROM players WHERE id = $1 AND org_id = $2 AND status = 'active'",
    [playerId, orgId]
  );
  if (!playerRows[0]) return res.status(404).json({ error: "שחקן לא נמצא" });
  // A one-timer placed straight into "attending" with a credit available
  // spends it here instead of needing a manual payment confirmation.
  const useCredit = nextStatus === "attending" && !playerRows[0].is_monthly_member && playerRows[0].credits > 0;
  const paymentConfirmed = Boolean(playerRows[0].is_monthly_member) || useCredit;
  await withClient(async (client) => {
    await client.query(
      `INSERT INTO registrations (org_id, match_id, player_id, status, payment_confirmed)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (org_id, match_id, player_id)
       DO UPDATE SET status = EXCLUDED.status, payment_confirmed = EXCLUDED.payment_confirmed, requested_at = now(),
         cancellation_reason = NULL, cancellation_review = NULL`,
      [orgId, matchId, playerId, nextStatus, paymentConfirmed]
    );
    if (useCredit) {
      await client.query("UPDATE players SET credits = credits - 1 WHERE id = $1 AND credits > 0", [playerId]);
      await client.query(
        `INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after_value)
         VALUES ($1, $2, 'credit_used', 'player', $3, $4)`,
        [orgId, req.user.id, playerId, JSON.stringify({ matchId })]
      );
    }
    await client.query(
      `INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after_value)
       VALUES ($1, $2, 'admin_add_registration', 'registration', $3, $4)`,
      [orgId, req.user.id, playerId, JSON.stringify({ matchId, playerId, status: nextStatus })]
    );
  });
  await rebalanceRegistrationQueue(matchId);
  res.status(201).json(await getMatchBundle(matchId, true, orgId));
}));

// Team builder's "add to bench": same one-step "admin's explicit
// confirmation they're playing" the team-assign endpoint below uses, just
// without landing on a team. Deliberately skips rebalanceRegistrationQueue —
// unlike the plain /registrations endpoint above, this must never quietly
// bump the player back to standby just because the fairness queue considers
// capacity already full (which, by the time an admin is in the team
// builder, it almost always is).
app.post("/api/admin/matches/:matchId/bench", asyncRoute(async (req, res) => {
  const { matchId } = req.params;
  const { playerId } = req.body;
  const orgId = req.user.org_id;
  if (!playerId) return res.status(400).json({ error: "לא נבחר שחקן" });
  const { rows: matchRows } = await query("SELECT id FROM matches WHERE id = $1 AND org_id = $2", [matchId, orgId]);
  if (!matchRows[0]) return res.status(404).json({ error: "מחזור לא נמצא" });
  const { rows: playerRows } = await query("SELECT id FROM players WHERE id = $1 AND org_id = $2 AND status = 'active'", [playerId, orgId]);
  if (!playerRows[0]) return res.status(404).json({ error: "שחקן לא נמצא" });
  await withClient(async (client) => {
    await client.query(
      `INSERT INTO registrations (org_id, match_id, player_id, status, payment_confirmed)
       VALUES ($1, $2, $3, 'attending', false)
       ON CONFLICT (org_id, match_id, player_id)
       DO UPDATE SET status = 'attending'`,
      [orgId, matchId, playerId]
    );
    await client.query(
      `INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after_value)
       VALUES ($1, $2, 'admin_add_registration', 'registration', $3, $4)`,
      [orgId, req.user.id, playerId, JSON.stringify({ matchId, playerId, status: "attending", bench: true })]
    );
  });
  res.status(201).json(await getMatchBundle(matchId, true, orgId));
}));

app.patch("/api/admin/registrations/:registrationId", asyncRoute(async (req, res) => {
  const { registrationId } = req.params;
  const { status, payment_confirmed, cancellation_reason, cancellation_review, credited } = req.body;
  const orgId = req.user.org_id;
  const { rows: before } = await query("SELECT * FROM registrations WHERE id = $1 AND org_id = $2", [registrationId, orgId]);
  if (!before[0]) return res.status(404).json({ error: "הרשמה לא נמצאה" });
  const { rows } = await query(
    `UPDATE registrations SET
      status = COALESCE($2::registration_status, status),
      payment_confirmed = COALESCE($3, payment_confirmed),
      cancellation_reason = COALESCE($4, cancellation_reason),
      cancellation_review = COALESCE($5, cancellation_review)
     WHERE id = $1 AND org_id = $6
     RETURNING *`,
    [registrationId, status, payment_confirmed, cancellation_reason, cancellation_review, orgId]
  );
  // Granted only the first time this cancellation is reviewed (before[0]
  // had no review yet) — reusing the button after the fact, or any retry,
  // must never grant a second credit for the same cancellation.
  if (credited === true && before[0].cancellation_review === null) {
    await query("UPDATE players SET credits = credits + 1 WHERE id = $1", [rows[0].player_id]);
    await query(
      `INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after_value)
       VALUES ($1, $2, 'credit_granted', 'player', $3, $4)`,
      [orgId, req.user.id, rows[0].player_id, JSON.stringify({ registrationId, matchId: rows[0].match_id })]
    );
  }
  // If this update took the player out of the match, free their team slot too.
  const droppedOut = ["cancelled", "not_attending"].includes(rows[0].status)
    && !["cancelled", "not_attending"].includes(before[0].status);
  if (droppedOut) {
    const vacated = await releaseFromTeams(rows[0].match_id, rows[0].player_id);
    if (vacated.length) {
      await query(
        `INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after_value)
         VALUES ($1, $2, 'player_left_team', 'team', $3, $4)`,
        [orgId, req.user.id, vacated[0].team_id, JSON.stringify({ matchId: rows[0].match_id, playerId: rows[0].player_id, vacated })]
      );
    }
  }
  await rebalanceRegistrationQueue(rows[0].match_id);
  await query(
    `INSERT INTO audit_log (org_id, action, entity_type, entity_id, before_value, after_value)
     VALUES ($1, 'admin_update_registration', 'registration', $2, $3, $4)`,
    [orgId, registrationId, JSON.stringify(before[0]), JSON.stringify(rows[0])]
  );
  res.json(await getMatchBundle(rows[0].match_id, true, orgId));
}));

// Bench a registration — confirmed or already out (cancelled/not_attending)
// — without fully removing it. Merely flipping status to 'standby' would
// get silently overwritten the next time anything else on this match
// triggers rebalanceRegistrationQueue, since that always re-derives status
// from requested_at order alone (see its own comments, and the identical
// trick in replace-with-standby below). Pushing requested_at to "now" bakes
// the demotion into the ordering data itself: it puts them at the back of
// the line, which is exactly where "moved to standby" should land them.
app.post("/api/admin/registrations/:registrationId/standby", asyncRoute(async (req, res) => {
  const { registrationId } = req.params;
  const orgId = req.user.org_id;
  const { rows } = await query(
    `SELECT r.*, p.is_monthly_member FROM registrations r
     JOIN players p ON p.id = r.player_id
     WHERE r.id = $1 AND r.org_id = $2`,
    [registrationId, orgId]
  );
  const registration = rows[0];
  if (!registration) return res.status(404).json({ error: "הרשמה לא נמצאה" });
  if (registration.status === "standby") return res.status(400).json({ error: "השחקן כבר ברשימת ההמתנה" });

  const wasOnFixture = ["attending", "payment_pending"].includes(registration.status);
  const isMonthly = Boolean(registration.is_monthly_member);
  const { rows: updated } = await query(
    `UPDATE registrations SET
      status = 'standby',
      payment_confirmed = $2,
      requested_at = now(),
      cancellation_reason = NULL,
      cancellation_review = NULL
     WHERE id = $1
     RETURNING *`,
    [registrationId, isMonthly]
  );
  if (wasOnFixture) await releaseFromTeams(registration.match_id, registration.player_id);

  await query(
    `INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, before_value, after_value)
     VALUES ($1, $2, 'admin_move_to_standby', 'registration', $3, $4, $5)`,
    [orgId, req.user.id, registrationId, JSON.stringify(registration), JSON.stringify(updated[0])]
  );
  res.json(await getMatchBundle(registration.match_id, true, orgId));
}));

// Game-day replacement: someone from standby takes an approved player's
// exact spot (same queue position), and the admin explicitly decides what
// happens to the outgoing approved player — dropped to standby, or removed
// from the match outright (lands under "יצאו מהרשימה").
//
// Deliberately does NOT call rebalanceRegistrationQueue. That function is
// designed to never auto-promote anyone once teams are already built (a
// cancellation there just leaves an understaffed team for the admin to
// backfill on purpose — see its own comments) — exactly the opposite of
// what this explicit two-tap admin action is for. It also always re-derives
// status from requested_at order alone, so a later call (triggered by any
// *other* unrelated change on this match) would ignore whatever status we
// set here. Both statuses are written directly instead, and requested_at is
// swapped between the two rows so the trade is baked into the ordering data
// itself — any future rebalance for something else independently reaches
// the same conclusion instead of undoing this one.
app.post("/api/admin/matches/:matchId/registrations/replace-with-standby", asyncRoute(async (req, res) => {
  const { matchId } = req.params;
  const { approvedRegistrationId, standbyRegistrationId, outgoingOutcome } = req.body;
  const orgId = req.user.org_id;
  if (!approvedRegistrationId || !standbyRegistrationId || approvedRegistrationId === standbyRegistrationId) {
    return res.status(400).json({ error: "יש לבחור שתי הרשמות שונות" });
  }
  if (!["standby", "removed"].includes(outgoingOutcome)) {
    return res.status(400).json({ error: "יש לבחור מה קורה עם השחקן שיוצא" });
  }
  const { rows } = await query(
    `SELECT r.id, r.status, r.requested_at, r.player_id, p.is_monthly_member
     FROM registrations r JOIN players p ON p.id = r.player_id
     WHERE r.id = ANY($1::uuid[]) AND r.match_id = $2 AND r.org_id = $3`,
    [[approvedRegistrationId, standbyRegistrationId], matchId, orgId]
  );
  const approved = rows.find((row) => row.id === approvedRegistrationId);
  const standby = rows.find((row) => row.id === standbyRegistrationId);
  if (!approved || !standby) return res.status(404).json({ error: "הרשמה לא נמצאה" });
  if (!["attending", "payment_pending"].includes(approved.status)) {
    return res.status(400).json({ error: "השחקן הראשון אינו מאושר כרגע" });
  }
  if (standby.status !== "standby") {
    return res.status(400).json({ error: "השחקן השני אינו ברשימת ההמתנה" });
  }

  // The incoming player takes the exact spot (approved's requested_at), but
  // whether it's actually PAID FOR is recomputed for them — same rule the
  // normal queue uses for anyone newly moving into a confirmed seat: a
  // monthly member goes straight to attending, a one-timer goes to
  // payment_pending rather than silently inheriting "confirmed, unpaid".
  const incomingIsMonthly = Boolean(standby.is_monthly_member);
  const incomingStatus = incomingIsMonthly ? "attending" : "payment_pending";
  await query(
    `UPDATE registrations SET status = $2::registration_status, payment_confirmed = $3, requested_at = $4
     WHERE id = $1`,
    [standby.id, incomingStatus, incomingIsMonthly, approved.requested_at]
  );

  if (outgoingOutcome === "removed") {
    await query(
      `UPDATE registrations SET status = 'cancelled', cancellation_reason = $2, cancellation_review = NULL WHERE id = $1`,
      [approved.id, "הוחלף בשחקן מרשימת ההמתנה"]
    );
  } else {
    // Dropping to standby, not cancelling — payment_confirmed resets too
    // (unless a monthly member, who's always "ready" regardless), so a
    // one-timer bumped to standby doesn't keep counting as an already-paid,
    // ready seat that some later, unrelated rebalance could pull straight
    // back into attending ahead of everyone else actually waiting.
    const outgoingIsMonthly = Boolean(approved.is_monthly_member);
    await query(
      `UPDATE registrations SET status = 'standby', payment_confirmed = $2, requested_at = $3 WHERE id = $1`,
      [approved.id, outgoingIsMonthly, standby.requested_at]
    );
  }
  // Whoever ends up not holding a confirmed slot loses any team seat too.
  await releaseFromTeams(matchId, approved.player_id);

  await query(
    `INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, before_value, after_value)
     VALUES ($1, $2, 'admin_replace_registration', 'registration', $3, $4, $5)`,
    [
      orgId, req.user.id, approved.id,
      JSON.stringify({ approvedRegistrationId, standbyRegistrationId, outgoingOutcome }),
      JSON.stringify({ promotedRegistrationId: standby.id, incomingStatus, outgoingOutcome })
    ]
  );
  res.json(await getMatchBundle(matchId, true, orgId));
}));

// Manual override of queue placement: dragging a registration to a new spot
// just rewrites requested_at for the whole active queue to match the new
// order, so every existing consumer of requested_at (rebalance, the roster,
// this same list) picks it up automatically — no separate "priority" column
// or duplicated sort logic to keep in sync.
app.patch("/api/admin/matches/:matchId/registrations/reorder", asyncRoute(async (req, res) => {
  const { matchId } = req.params;
  const { registrationId, toIndex } = req.body;
  const orgId = req.user.org_id;
  if (!(await assertOrgOwns("matches", matchId, orgId))) return res.status(404).json({ error: "מחזור לא נמצא" });
  const { rows: registrations } = await query(
    `SELECT id FROM registrations
     WHERE match_id = $1 AND org_id = $2 AND status NOT IN ('cancelled', 'not_attending')
     ORDER BY requested_at ASC, id ASC`,
    [matchId, orgId]
  );
  const ids = registrations.map((registration) => registration.id);
  const fromIndex = ids.indexOf(registrationId);
  if (fromIndex === -1) return res.status(404).json({ error: "הרשמה לא נמצאה" });
  ids.splice(fromIndex, 1);
  ids.splice(Math.max(0, Math.min(ids.length, Number(toIndex))), 0, registrationId);

  const base = Date.now() - ids.length * 1000;
  await withClient(async (client) => {
    for (let index = 0; index < ids.length; index += 1) {
      await client.query("UPDATE registrations SET requested_at = $2 WHERE id = $1", [ids[index], new Date(base + index * 1000)]);
    }
  });
  await rebalanceRegistrationQueue(matchId);
  await query(
    `INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id)
     VALUES ($1, $2, 'admin_reorder_registration', 'registration', $3)`,
    [orgId, req.user.id, registrationId]
  );
  res.json(await getMatchBundle(matchId, true, orgId));
}));

app.delete("/api/admin/matches/:matchId", asyncRoute(async (req, res) => {
  const { matchId } = req.params;
  const orgId = req.user.org_id;
  const { rows: before } = await query(
    "SELECT * FROM matches WHERE id = $1 AND org_id = $2",
    [matchId, orgId]
  );
  if (!before[0]) return res.status(404).json({ error: "מחזור לא נמצא" });

  // Everything below a match cascades away with it — keep a record of what was
  // destroyed, since this cannot be undone.
  const { rows: counts } = await query(
    `SELECT
       (SELECT COUNT(*)::int FROM registrations WHERE match_id = $1) AS registrations,
       (SELECT COUNT(*)::int FROM pitches WHERE match_id = $1) AS pitches,
       (SELECT COUNT(*)::int FROM teams t JOIN pitches p ON p.id = t.pitch_id WHERE p.match_id = $1) AS teams,
       (SELECT COUNT(*)::int FROM game_results g JOIN pitches p ON p.id = g.pitch_id WHERE p.match_id = $1) AS games,
       (SELECT COUNT(*)::int FROM match_standouts WHERE match_id = $1) AS standouts`,
    [matchId]
  );

  await query("DELETE FROM matches WHERE id = $1 AND org_id = $2", [matchId, orgId]);
  await query(
    `INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, before_value)
     VALUES ($1, $2, 'admin_delete_match', 'match', $3, $4)`,
    [orgId, req.user.id, matchId, JSON.stringify({ match: before[0], deleted: counts[0] })]
  );
  res.json({ ok: true, deleted: counts[0] });
}));

app.post("/api/admin/matches/:matchId/pitches", asyncRoute(async (req, res) => {
  const { matchId } = req.params;
  const { label, isSenior } = req.body;
  const orgId = req.user.org_id;
  const { rows: matchRows } = await query("SELECT teams_per_pitch FROM matches WHERE id = $1 AND org_id = $2", [matchId, orgId]);
  if (!matchRows[0]) return res.status(404).json({ error: "מחזור לא נמצא" });
  const { rows: nextRows } = await query("SELECT COALESCE(MAX(pitch_number), 0) + 1 AS next_number FROM pitches WHERE match_id = $1", [matchId]);
  const nextNumber = Number(nextRows[0].next_number);
  const { rows } = await query(
    `INSERT INTO pitches (org_id, match_id, pitch_number, label, is_senior)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [orgId, matchId, nextNumber, label || `מגרש ${nextNumber}`, Boolean(isSenior)]
  );
  await createTeamsForPitch(rows[0].id, Number(matchRows[0].teams_per_pitch || 3), orgId);
  await query("UPDATE matches SET approved_pitch_count = (SELECT COUNT(*) FROM pitches WHERE match_id = $1) WHERE id = $1", [matchId]);
  res.status(201).json(await getMatchBundle(matchId, true, orgId));
}));

app.patch("/api/admin/pitches/:pitchId", asyncRoute(async (req, res) => {
  const { pitchId } = req.params;
  const { label, is_senior } = req.body;
  const orgId = req.user.org_id;
  const { rows } = await query(
    `UPDATE pitches SET
      label = COALESCE($2, label),
      is_senior = COALESCE($3, is_senior)
     WHERE id = $1 AND org_id = $4
     RETURNING match_id`,
    [pitchId, label, is_senior, orgId]
  );
  if (!rows[0]) return res.status(404).json({ error: "מגרש לא נמצא" });
  res.json(await getMatchBundle(rows[0].match_id, true, orgId));
}));

// Closing a pitch drops its teams (and, with them, any recorded games/goals)
// via ON DELETE CASCADE — team_players goes with it, so whoever was on this
// pitch simply stops being assigned anywhere and reappears in the unassigned
// pool on the client, with no separate "move to bench" step needed.
//
// Deliberately does NOT lower approved_pitch_count to match the new, smaller
// physical count: rebalanceRegistrationQueue re-opens pitches automatically
// whenever registrations justify more of them than approved_pitch_count
// currently allows, so lowering it here would just have the very next admin
// page load recreate the pitch that was just closed. Leaving the ceiling
// where it was means it only grows again once genuinely more players
// register than it already accounted for.
app.delete("/api/admin/pitches/:pitchId", asyncRoute(async (req, res) => {
  const { pitchId } = req.params;
  const orgId = req.user.org_id;
  const { rows } = await query("DELETE FROM pitches WHERE id = $1 AND org_id = $2 RETURNING match_id", [pitchId, orgId]);
  if (!rows[0]) return res.status(404).json({ error: "מגרש לא נמצא" });
  const matchId = rows[0].match_id;
  res.json(await getMatchBundle(matchId, true, orgId));
}));

app.patch("/api/admin/teams/:teamId", asyncRoute(async (req, res) => {
  const { teamId } = req.params;
  const { color_name, color_hex, summary } = req.body;
  if (color_name || color_hex) {
    const allowed = FIXED_TEAM_COLORS.some(([name, hex]) => name === color_name && hex.toLowerCase() === String(color_hex).toLowerCase());
    if (!allowed) return res.status(400).json({ error: "צבע קבוצה חייב להיות מתוך הפלטה הקבועה" });
  }
  const orgId = req.user.org_id;
  const { rows } = await query(
    `UPDATE teams SET
      color_name = COALESCE($2, color_name),
      color_hex = COALESCE($3, color_hex),
      summary = COALESCE($4, summary)
     WHERE id = $1 AND org_id = $5
     RETURNING pitch_id`,
    [teamId, color_name, color_hex, summary, orgId]
  );
  if (!rows[0]) return res.status(404).json({ error: "קבוצה לא נמצאה" });
  const match = await matchIdForPitch(rows[0].pitch_id);
  res.json(await getMatchBundle(match, true, orgId));
}));

app.post("/api/admin/teams/:teamId/players", asyncRoute(async (req, res) => {
  const { teamId } = req.params;
  const { playerId, action } = req.body;
  const orgId = req.user.org_id;
  if (!playerId) return res.status(400).json({ error: "לא נבחר שחקן" });
  const { rows } = await query(
    `SELECT pi.match_id FROM teams t JOIN pitches pi ON pi.id = t.pitch_id
     WHERE t.id = $1 AND t.org_id = $2`,
    [teamId, orgId]
  );
  if (!rows[0]) return res.status(404).json({ error: "קבוצה לא נמצאה" });
  const matchId = rows[0].match_id;
  await withClient(async (client) => {
    if (action !== "remove") {
      // Assigning a player straight onto a team is the admin's own explicit
      // confirmation that they're playing — register them as attending in
      // the same step instead of requiring a separate registration action
      // first. Skipped entirely when already attending, so an existing
      // payment_confirmed/requested_at is never reset by re-assigning someone
      // who was already eligible.
      const { rows: eligibleRows } = await client.query(
        `SELECT 1 FROM registrations WHERE match_id = $1 AND player_id = $2 AND status = 'attending'`,
        [matchId, playerId]
      );
      if (!eligibleRows[0]) {
        await client.query(
          `INSERT INTO registrations (org_id, match_id, player_id, status, payment_confirmed)
           VALUES ($1, $2, $3, 'attending', false)
           ON CONFLICT (org_id, match_id, player_id)
           DO UPDATE SET status = 'attending'`,
          [orgId, matchId, playerId]
        );
      }
    }
    await client.query(
      `DELETE FROM team_players
       WHERE player_id = $1 AND team_id IN (
        SELECT t.id FROM teams t JOIN pitches p ON p.id = t.pitch_id WHERE p.match_id = $2
       )`,
      [playerId, matchId]
    );
    if (action !== "remove") {
      await client.query("INSERT INTO team_players (org_id, team_id, player_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [orgId, teamId, playerId]);
    }
    await client.query(
      `INSERT INTO audit_log (org_id, action, entity_type, entity_id, after_value)
       VALUES ($1, 'admin_assign_player', 'team', $2, $3)`,
      [orgId, teamId, JSON.stringify({ playerId, action: action || "add" })]
    );
  });
  res.json(await getMatchBundle(matchId, true, orgId));
}));

// Swap two players' placements in one shot — each takes the other's team
// (or pool slot), rather than the caller doing two separate assign calls
// that would briefly overfill the target team and could interleave badly.
app.post("/api/admin/matches/:matchId/swap-players", asyncRoute(async (req, res) => {
  const { matchId } = req.params;
  const { playerAId, playerBId } = req.body;
  const orgId = req.user.org_id;
  if (!playerAId || !playerBId || playerAId === playerBId) {
    return res.status(400).json({ error: "יש לבחור שני שחקנים שונים" });
  }
  const { rows: matchRows } = await query("SELECT id FROM matches WHERE id = $1 AND org_id = $2", [matchId, orgId]);
  if (!matchRows[0]) return res.status(404).json({ error: "מחזור לא נמצא" });

  const { rows: currentRows } = await query(
    `SELECT tp.player_id, tp.team_id FROM team_players tp
     JOIN teams t ON t.id = tp.team_id
     JOIN pitches p ON p.id = t.pitch_id
     WHERE p.match_id = $1 AND tp.player_id = ANY($2::uuid[])`,
    [matchId, [playerAId, playerBId]]
  );
  const teamOf = Object.fromEntries(currentRows.map((row) => [row.player_id, row.team_id]));
  const aTeam = teamOf[playerAId] || null;
  const bTeam = teamOf[playerBId] || null;

  await withClient(async (client) => {
    // Same as the single-player assign endpoint: swapping either player onto
    // a team is the admin's explicit confirmation they're playing, so
    // register whichever one isn't already attending in the same step.
    const { rows: eligibleRows } = await client.query(
      `SELECT player_id FROM registrations WHERE match_id = $1 AND player_id = ANY($2::uuid[]) AND status = 'attending'`,
      [matchId, [playerAId, playerBId]]
    );
    const eligible = new Set(eligibleRows.map((row) => row.player_id));
    for (const playerId of [playerAId, playerBId]) {
      if (eligible.has(playerId)) continue;
      await client.query(
        `INSERT INTO registrations (org_id, match_id, player_id, status, payment_confirmed)
         VALUES ($1, $2, $3, 'attending', false)
         ON CONFLICT (org_id, match_id, player_id)
         DO UPDATE SET status = 'attending'`,
        [orgId, matchId, playerId]
      );
    }

    await client.query(
      `DELETE FROM team_players WHERE player_id = ANY($1::uuid[]) AND team_id IN (
        SELECT t.id FROM teams t JOIN pitches p ON p.id = t.pitch_id WHERE p.match_id = $2
      )`,
      [[playerAId, playerBId], matchId]
    );
    if (bTeam) {
      await client.query("INSERT INTO team_players (org_id, team_id, player_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [orgId, bTeam, playerAId]);
    }
    if (aTeam) {
      await client.query("INSERT INTO team_players (org_id, team_id, player_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [orgId, aTeam, playerBId]);
    }
    await client.query(
      `INSERT INTO audit_log (org_id, action, entity_type, entity_id, after_value)
       VALUES ($1, 'admin_swap_players', 'match', $2, $3)`,
      [orgId, matchId, JSON.stringify({ playerAId, playerBId, aTeam, bTeam })]
    );
  });

  res.json(await getMatchBundle(matchId, true, orgId));
}));

app.post("/api/admin/matches/:matchId/autobalance", asyncRoute(async (req, res) => {
  const { matchId } = req.params;
  const orgId = req.user.org_id;
  if (!(await assertOrgOwns("matches", matchId, orgId))) return res.status(404).json({ error: "מחזור לא נמצא" });

  // Without pitches/teams there is nothing to fill, and without confirmed
  // players there is nobody to place. Say so instead of silently doing nothing.
  const { rows: teamRows } = await query(
    `SELECT COUNT(t.id)::int AS count
     FROM teams t JOIN pitches p ON p.id = t.pitch_id
     WHERE p.match_id = $1 AND t.org_id = $2`,
    [matchId, orgId]
  );
  if (!teamRows[0].count) {
    return res.status(400).json({ error: "אין מגרשים או קבוצות במחזור — צריך ליצור מגרשים לפני חלוקה" });
  }
  const { rows: playerRows } = await query(
    `SELECT COUNT(*)::int AS count FROM registrations
     WHERE match_id = $1 AND org_id = $2 AND status = 'attending'`,
    [matchId, orgId]
  );
  if (!playerRows[0].count) {
    return res.status(400).json({ error: "אין שחקנים מאושרים לחלוקה" });
  }

  await autoBalance(matchId, orgId);
  // Only advance the progress axis, and only from 'draft' — building teams must
  // not reopen a published fixture, and must never touch registration openness.
  await query(
    "UPDATE matches SET status = 'teams_draft' WHERE id = $1 AND org_id = $2 AND status = 'draft'",
    [matchId, orgId]
  );
  res.json(await getMatchBundle(matchId, true, orgId));
}));

app.post("/api/admin/pitches/:pitchId/games", asyncRoute(async (req, res) => {
  const { pitchId } = req.params;
  const { teamAId, teamBId, teamAGoals, teamBGoals, endedBy, events } = req.body;
  const orgId = req.user.org_id;
  const { rows: pitchRows } = await query("SELECT 1 FROM pitches WHERE id = $1 AND org_id = $2", [pitchId, orgId]);
  if (!pitchRows[0]) return res.status(404).json({ error: "מגרש לא נמצא" });
  const { rows: orderRows } = await query("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM game_results WHERE pitch_id = $1", [pitchId]);
  const game = await withClient(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO game_results (org_id, pitch_id, team_a_id, team_b_id, team_a_goals, team_b_goals, ended_by, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [orgId, pitchId, teamAId, teamBId, Number(teamAGoals || 0), Number(teamBGoals || 0), endedBy || "time", orderRows[0].next_order]
    );
    for (const event of events || []) {
      if (!event.scorerId || !event.teamId) continue;
      await client.query(
        `INSERT INTO goal_events (org_id, game_id, scorer_id, assist_id, team_id, own_goal)
         VALUES ($1, $2, $3, NULLIF($4, '')::uuid, $5, $6)`,
        [orgId, rows[0].id, event.scorerId, event.assistId || "", event.teamId, Boolean(event.ownGoal)]
      );
    }
    return rows[0];
  });
  const matchId = await matchIdForPitch(pitchId);
  await query(
    `INSERT INTO audit_log (org_id, action, entity_type, entity_id, after_value)
     VALUES ($1, 'stats_add_game', 'game', $2, $3)`,
    [orgId, game.id, JSON.stringify(game)]
  );
  res.json(await getMatchBundle(matchId, true, orgId));
}));

// Edit an already-recorded game: which teams played (a wrong pairing typed
// at entry) and/or the scoreline itself. Goal events are managed separately
// below — same "type the score, backfill who scored" split as creation, so
// editing the score never requires the events to add up to it.
app.patch("/api/admin/games/:gameId", asyncRoute(async (req, res) => {
  const { gameId } = req.params;
  const { teamAId, teamBId, teamAGoals, teamBGoals, endedBy } = req.body;
  const orgId = req.user.org_id;
  const { rows: before } = await query("SELECT * FROM game_results WHERE id = $1 AND org_id = $2", [gameId, orgId]);
  if (!before[0]) return res.status(404).json({ error: "משחק לא נמצא" });
  const nextTeamAId = teamAId || before[0].team_a_id;
  const nextTeamBId = teamBId || before[0].team_b_id;
  if (nextTeamAId === nextTeamBId) return res.status(400).json({ error: "יש לבחור שתי קבוצות שונות" });
  if (teamAId || teamBId) {
    const { rows: teamRows } = await query(
      "SELECT id FROM teams WHERE pitch_id = $1 AND id = ANY($2::uuid[])",
      [before[0].pitch_id, [nextTeamAId, nextTeamBId]]
    );
    if (teamRows.length !== 2) return res.status(400).json({ error: "הקבוצות חייבות להיות מהמגרש הזה" });
  }
  const { rows } = await query(
    `UPDATE game_results SET
      team_a_id = $2,
      team_b_id = $3,
      team_a_goals = COALESCE($4, team_a_goals),
      team_b_goals = COALESCE($5, team_b_goals),
      ended_by = COALESCE($6, ended_by)
     WHERE id = $1 AND org_id = $7
     RETURNING *`,
    [
      gameId, nextTeamAId, nextTeamBId,
      teamAGoals === undefined || teamAGoals === null ? null : Number(teamAGoals),
      teamBGoals === undefined || teamBGoals === null ? null : Number(teamBGoals),
      endedBy || null, orgId
    ]
  );
  const matchId = await matchIdForPitch(rows[0].pitch_id);
  await query(
    `INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, before_value, after_value)
     VALUES ($1, $2, 'admin_update_game', 'game', $3, $4, $5)`,
    [orgId, req.user.id, gameId, JSON.stringify(before[0]), JSON.stringify(rows[0])]
  );
  res.json(await getMatchBundle(matchId, true, orgId));
}));

app.delete("/api/admin/games/:gameId", asyncRoute(async (req, res) => {
  const { gameId } = req.params;
  const orgId = req.user.org_id;
  const { rows } = await query("SELECT pitch_id FROM game_results WHERE id = $1 AND org_id = $2", [gameId, orgId]);
  if (!rows[0]) return res.status(404).json({ error: "משחק לא נמצא" });
  const matchId = await matchIdForPitch(rows[0].pitch_id);
  await query("DELETE FROM game_results WHERE id = $1 AND org_id = $2", [gameId, orgId]);
  res.json(await getMatchBundle(matchId, true, orgId));
}));

// Admin backfill of a goal onto an already-recorded game — same shape as the
// per-event inserts at creation (an explicit teamId, no roster-membership
// check; the admin is trusted and the scorer may not even be in this bundle
// e.g. a late lineup correction), just addressable on its own afterwards.
app.post("/api/admin/games/:gameId/goals", asyncRoute(async (req, res) => {
  const { gameId } = req.params;
  const { scorerId, assistId, teamId, ownGoal } = req.body;
  const orgId = req.user.org_id;
  const { rows: gameRows } = await query("SELECT pitch_id FROM game_results WHERE id = $1 AND org_id = $2", [gameId, orgId]);
  if (!gameRows[0]) return res.status(404).json({ error: "משחק לא נמצא" });
  if (!scorerId || !teamId) return res.status(400).json({ error: "יש לבחור כובש וקבוצה" });
  if (!ownGoal && assistId && assistId === scorerId) {
    return res.status(400).json({ error: "כובש לא יכול לבשל לעצמו" });
  }
  const { rows } = await query(
    `INSERT INTO goal_events (org_id, game_id, scorer_id, assist_id, team_id, own_goal)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [orgId, gameId, scorerId, ownGoal ? null : (assistId || null), teamId, Boolean(ownGoal)]
  );
  const matchId = await matchIdForPitch(gameRows[0].pitch_id);
  await query(
    `INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after_value)
     VALUES ($1, $2, 'admin_add_goal', 'goal', $3, $4)`,
    [orgId, req.user.id, rows[0].id, JSON.stringify(rows[0])]
  );
  res.json(await getMatchBundle(matchId, true, orgId));
}));

app.delete("/api/admin/games/:gameId/goals/:goalId", asyncRoute(async (req, res) => {
  const { gameId, goalId } = req.params;
  const orgId = req.user.org_id;
  const { rows: gameRows } = await query("SELECT pitch_id FROM game_results WHERE id = $1 AND org_id = $2", [gameId, orgId]);
  if (!gameRows[0]) return res.status(404).json({ error: "משחק לא נמצא" });
  const matchId = await matchIdForPitch(gameRows[0].pitch_id);
  await query("DELETE FROM goal_events WHERE id = $1 AND game_id = $2 AND org_id = $3", [goalId, gameId, orgId]);
  await query(
    `INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id)
     VALUES ($1, $2, 'admin_remove_goal', 'goal', $3)`,
    [orgId, req.user.id, goalId]
  );
  res.json(await getMatchBundle(matchId, true, orgId));
}));

app.post("/api/admin/matches/:matchId/standouts", asyncRoute(async (req, res) => {
  const { matchId } = req.params;
  const { standouts } = req.body;
  if (!Array.isArray(standouts) || standouts.length !== 5 || new Set(standouts.map((item) => item.playerId)).size !== 5) {
    return res.status(400).json({ error: "חובה לבחור בדיוק חמישה מצטיינים שונים" });
  }
  const orgId = req.user.org_id;
  if (!(await assertOrgOwns("matches", matchId, orgId))) return res.status(404).json({ error: "מחזור לא נמצא" });
  await withClient(async (client) => {
    await client.query("DELETE FROM match_standouts WHERE match_id = $1 AND org_id = $2", [matchId, orgId]);
    for (let index = 0; index < standouts.length; index += 1) {
      await client.query(
        `INSERT INTO match_standouts (org_id, match_id, player_id, reason, sort_order)
         VALUES ($1, $2, $3, $4, $5)`,
        [orgId, matchId, standouts[index].playerId, standouts[index].reason || null, index + 1]
      );
    }
  });
  res.json(await getMatchBundle(matchId, true, orgId));
}));

async function setupPitches(matchId, pitchCount, teamsPerPitch = 3, orgId = null) {
  const resolvedOrg = orgId || (await matchOrgId(matchId));
  await query("DELETE FROM pitches WHERE match_id = $1 AND pitch_number > $2", [matchId, pitchCount]);
  for (let index = 1; index <= pitchCount; index += 1) {
    const { rows } = await query(
      `INSERT INTO pitches (org_id, match_id, pitch_number, label, is_senior)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (org_id, match_id, pitch_number)
       DO UPDATE SET label = EXCLUDED.label
       RETURNING id`,
      [resolvedOrg, matchId, index, index === 1 ? "מגרש בכיר" : `מגרש ${index}`, index === 1]
    );
    await query("DELETE FROM teams WHERE pitch_id = $1 AND sort_order > $2", [rows[0].id, teamsPerPitch]);
    await createTeamsForPitch(rows[0].id, teamsPerPitch, resolvedOrg);
  }
}

// Look up the owning org for a match — used when a caller has no org context.
async function matchOrgId(matchId) {
  const { rows } = await query("SELECT org_id FROM matches WHERE id = $1", [matchId]);
  return rows[0]?.org_id || null;
}

async function createTeamsForPitch(pitchId, teamsPerPitch = 3, orgId = null) {
  for (let teamIndex = 0; teamIndex < teamsPerPitch; teamIndex += 1) {
    const color = FIXED_TEAM_COLORS[teamIndex % FIXED_TEAM_COLORS.length];
    await query(
      `INSERT INTO teams (org_id, pitch_id, color_name, color_hex, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (pitch_id, sort_order) DO NOTHING`,
      [orgId, pitchId, color[0], color[1], teamIndex + 1]
    );
  }
}

async function autoBalance(matchId, orgId = null) {
  const resolvedOrg = orgId || (await matchOrgId(matchId));
  const { rows: teams } = await query(
    `SELECT t.id, p.is_senior FROM teams t JOIN pitches p ON p.id = t.pitch_id WHERE p.match_id = $1 ORDER BY p.pitch_number, t.sort_order`,
    [matchId]
  );
  const { rows: players } = await query(
    `SELECT p.*, ROUND((p.attack * 0.5 + p.defense * 0.4 + p.fitness * 0.1)::numeric, 1) AS overall
     FROM registrations r JOIN players p ON p.id = r.player_id
     WHERE r.match_id = $1 AND r.status = 'attending'
     ORDER BY p.is_senior_pitch DESC, overall DESC, p.full_name`,
    [matchId]
  );
  const { rows: matchRows } = await query("SELECT players_per_team FROM matches WHERE id = $1", [matchId]);
  const playersPerTeam = Number(matchRows[0]?.players_per_team || 5);

  const seniorTeams = teams.filter((team) => team.is_senior);
  const regularTeams = teams.filter((team) => !team.is_senior);
  const seniorPlayers = players.filter((player) => player.is_senior_pitch);
  const regularPlayers = players.filter((player) => !player.is_senior_pitch);

  // Senior pitches take senior players first, but they are not reserved: any
  // seats left over are filled from the regular pool so no team sits short
  // while players are still unassigned.
  const seniorSeats = seniorTeams.length * playersPerTeam;
  const seniorsOnSeniorPitch = seniorPlayers.slice(0, seniorSeats);
  const leftoverSeniors = seniorPlayers.slice(seniorSeats);

  // Only top up the senior pitch from the regular pool when there are enough
  // players to go round. Otherwise a small turnout would fill the senior pitch
  // and leave the regular pitches empty instead of spreading everyone out.
  const totalSeats = teams.length * playersPerTeam;
  const enoughToFillEveryTeam = players.length >= totalSeats;
  const seniorFillCount = enoughToFillEveryTeam
    ? Math.max(0, seniorSeats - seniorsOnSeniorPitch.length)
    : Math.max(
        0,
        // Give the senior pitch only its proportional share of a short turnout.
        Math.min(
          seniorSeats - seniorsOnSeniorPitch.length,
          Math.round((players.length * seniorTeams.length) / (teams.length || 1)) - seniorsOnSeniorPitch.length
        )
      );
  const regularForSeniorPitch = regularPlayers.slice(0, seniorFillCount);
  const regularRemaining = regularPlayers.slice(seniorFillCount);

  const seniorPitchSquad = [...seniorsOnSeniorPitch, ...regularForSeniorPitch];
  // Seniors beyond the senior pitch play on the regular pitches.
  const regularPitchSquad = [...leftoverSeniors, ...regularRemaining];

  await withClient(async (client) => {
    await client.query(
      `DELETE FROM team_players WHERE team_id IN (
        SELECT t.id FROM teams t JOIN pitches p ON p.id = t.pitch_id WHERE p.match_id = $1
      )`,
      [matchId]
    );

    // Snake draft by rating into the emptiest team, never exceeding
    // playersPerTeam. Players who do not fit are simply left unassigned.
    async function fillBuckets(teamRows, playerRows) {
      const buckets = teamRows.map((team) => ({ id: team.id, score: 0, count: 0 }));
      if (!buckets.length) return playerRows;
      const unplaced = [];
      for (const player of playerRows) {
        const open = buckets.filter((bucket) => bucket.count < playersPerTeam);
        if (!open.length) {
          unplaced.push(player);
          continue;
        }
        // Fewest players first, then lowest total rating, so squads stay even
        // in size and comparable in strength.
        open.sort((a, b) => a.count - b.count || a.score - b.score);
        const bucket = open[0];
        await client.query(
          "INSERT INTO team_players (org_id, team_id, player_id) VALUES ($1, $2, $3)",
          [resolvedOrg, bucket.id, player.id]
        );
        bucket.score += Number(player.overall);
        bucket.count += 1;
      }
      return unplaced;
    }

    // Anyone who cannot fit on the senior pitch still gets a shot at a regular one.
    const spilloverFromSenior = await fillBuckets(seniorTeams, seniorPitchSquad);
    await fillBuckets(regularTeams, [...spilloverFromSenior, ...regularPitchSquad]);
  });
}

async function rebalanceRegistrationQueue(matchId) {
  const { rows: matchRows } = await query("SELECT status, org_id, approved_pitch_count, teams_per_pitch, players_per_team FROM matches WHERE id = $1", [matchId]);
  const match = matchRows[0];
  if (!match) return;

  const capacity = Number(match.teams_per_pitch || 3) * Number(match.players_per_team || 5);
  if (!capacity) return;

  const { rows: registrations } = await query(
    `SELECT r.id, r.status, r.payment_confirmed, r.requested_at, p.is_monthly_member
     FROM registrations r
     JOIN players p ON p.id = r.player_id
     WHERE r.match_id = $1
       AND r.status NOT IN ('cancelled', 'not_attending')
     ORDER BY r.requested_at ASC, r.id ASC`,
    [matchId]
  );

  // Pitches open automatically as complete groups accumulate — one full
  // pitch's worth of interest justifies a physical pitch on its own, without
  // waiting for an admin to notice and bump the count. They never CLOSE
  // automatically: shrinking cascades away teams/results, which must stay a
  // deliberate admin action.
  const neededPitches = Math.floor(registrations.length / capacity);
  if (neededPitches > Number(match.approved_pitch_count || 0)) {
    await query("UPDATE matches SET approved_pitch_count = $2 WHERE id = $1", [matchId, neededPitches]);
    await setupPitches(matchId, neededPitches, match.teams_per_pitch, match.org_id);
    match.approved_pitch_count = neededPitches;
  }
  const totalCapacity = Number(match.approved_pitch_count || 0) * capacity;

  // Before teams are built, confirmation only happens in a COMPLETE pitch's
  // worth of players — a partial turnout books nothing. Once teams exist
  // (teams_draft or later), players already confirmed (or already queued for
  // payment) keep their seat, up to however much real pitch capacity now
  // exists — a cancellation just leaves an understaffed team for the admin to
  // backfill, rather than bumping everyone else back to standby. Crucially
  // this must never GROW past who was already confirmed: approved_pitch_count
  // only ever increases automatically (never shrinks on its own), so once
  // teams are built it can be stale relative to the current headcount — using
  // it directly here would silently promote standby players into attending
  // (and onto a team on the next "suggest teams") with no admin ever
  // approving the extra capacity.
  const teamsBuilt = match.status !== "draft";
  const previouslyConfirmedCount = registrations
    .filter((registration) => ["attending", "payment_pending"].includes(registration.status)).length;
  const completeGroupSlots = teamsBuilt
    ? Math.min(totalCapacity, previouslyConfirmedCount)
    : Math.floor(registrations.length / capacity) * capacity;
  // Placement is pure first-come-first-served: a monthly member registering
  // late does not jump ahead of a one-timer who registered earlier. Members
  // only ever end up "ready" sooner because they skip the payment step, not
  // because of any priority here.
  const readyRegistrations = registrations
    .filter((registration) => registration.is_monthly_member || registration.payment_confirmed)
    .sort((a, b) => new Date(a.requested_at) - new Date(b.requested_at));
  const assignedReadyIds = new Set(readyRegistrations.slice(0, completeGroupSlots).map((registration) => registration.id));
  const unpaidOneTimers = registrations.filter((registration) => !registration.is_monthly_member && !registration.payment_confirmed);
  const existingPendingIds = new Set(
    unpaidOneTimers
      .filter((registration) => registration.status === "payment_pending")
      .map((registration) => registration.id)
  );
  const neededPaymentCount = Math.max(0, completeGroupSlots - assignedReadyIds.size);
  const neededPaymentIds = new Set(
    unpaidOneTimers
      .slice(0, neededPaymentCount)
      .map((registration) => registration.id)
  );

  await withClient(async (client) => {
    for (const registration of registrations) {
      const nextStatus = assignedReadyIds.has(registration.id)
        ? "attending"
        : existingPendingIds.has(registration.id) || neededPaymentIds.has(registration.id)
          ? "payment_pending"
          : "standby";
      const nextPaymentConfirmed = Boolean(registration.is_monthly_member || registration.payment_confirmed);

      if (registration.status !== nextStatus || registration.payment_confirmed !== nextPaymentConfirmed) {
        await client.query(
          "UPDATE registrations SET status = $2::registration_status, payment_confirmed = $3 WHERE id = $1",
          [registration.id, nextStatus, nextPaymentConfirmed]
        );
      }
    }
  });
}

// Drop a player from whatever team they hold on this match, if any — used
// whenever a registration leaves the attending pool (self-cancel, admin
// cancel/not-attending) so a vacated seat never lingers on a built lineup.
async function releaseFromTeams(matchId, playerId) {
  const { rows } = await query(
    `DELETE FROM team_players
     WHERE player_id = $2 AND team_id IN (
       SELECT t.id FROM teams t JOIN pitches p ON p.id = t.pitch_id WHERE p.match_id = $1
     )
     RETURNING team_id, player_id`,
    [matchId, playerId]
  );
  return rows;
}

async function matchIdForPitch(pitchId) {
  const { rows } = await query("SELECT match_id FROM pitches WHERE id = $1", [pitchId]);
  return rows[0]?.match_id;
}

app.post("/api/matches/:matchId/register", asyncRoute(async (req, res) => {
  const { matchId } = req.params;
  const { playerId, attending } = req.body;
  const status = attending ? "standby" : "not_attending";
  // The match and the player must belong to the SAME organization.
  const { rows: guardRows } = await query(
    `SELECT m.members_can_register, m.one_timers_can_register, m.org_id, p.is_monthly_member, p.credits
     FROM matches m
     JOIN players p ON p.org_id = m.org_id
     WHERE m.id = $1 AND p.id = $2`,
    [matchId, playerId]
  );
  const guard = guardRows[0];
  if (!guard) return res.status(404).json({ error: "מחזור או שחקן לא נמצאו" });
  const orgId = guard.org_id;
  // Each audience is gated by its own flag, so "one-timers only" is expressible.
  if (attending) {
    const gate = guard.is_monthly_member ? guard.members_can_register : guard.one_timers_can_register;
    if (!gate) {
      return res.status(guard.members_can_register || guard.one_timers_can_register ? 403 : 400).json({
        error: guard.members_can_register
          ? "ההרשמה פתוחה כרגע למנויים בלבד"
          : guard.one_timers_can_register
            ? "ההרשמה פתוחה כרגע לשחקנים חד־פעמיים בלבד"
            : "ההרשמה למחזור הזה סגורה"
      });
    }
  }
  // A one-timer with a credit (granted earlier from an approved
  // cancellation) spends it here instead of going through payment_pending —
  // the registration is marked paid immediately, same as a monthly member.
  const useCredit = attending && !guard.is_monthly_member && guard.credits > 0;
  await withClient(async (client) => {
    await client.query(
      `INSERT INTO registrations (org_id, match_id, player_id, status, payment_confirmed)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (org_id, match_id, player_id)
       DO UPDATE SET status = EXCLUDED.status, payment_confirmed = EXCLUDED.payment_confirmed, requested_at = now()`,
      [orgId, matchId, playerId, status, useCredit]
    );
    if (useCredit) {
      await client.query("UPDATE players SET credits = credits - 1 WHERE id = $1 AND credits > 0", [playerId]);
      await client.query(
        `INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after_value)
         VALUES ($1, $2, 'credit_used', 'player', $2, $3)`,
        [orgId, playerId, JSON.stringify({ matchId })]
      );
    }
    await client.query(
      `INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after_value)
       VALUES ($1, $2, $3, 'registration', $4, $5)`,
      [orgId, playerId, attending ? "player_attending" : "player_not_attending", matchId, JSON.stringify({ status })]
    );
  });
  await rebalanceRegistrationQueue(matchId);
  res.json(await getMatchBundle(matchId, false, orgId));
}));

app.post("/api/matches/:matchId/cancel", asyncRoute(async (req, res) => {
  const { matchId } = req.params;
  const { playerId, reason } = req.body;
  const { rows: owner } = await query(
    `SELECT org_id FROM registrations WHERE match_id = $1 AND player_id = $2`,
    [matchId, playerId]
  );
  if (!owner[0]) return res.status(404).json({ error: "הרשמה לא נמצאה" });
  const orgId = owner[0].org_id;
  await query(
    `UPDATE registrations
     SET status = 'cancelled', cancellation_reason = $3
     WHERE match_id = $1 AND player_id = $2 AND org_id = $4`,
    [matchId, playerId, reason || "לא צוינה סיבה", orgId]
  );
  // Free the slot: a cancelled player cannot remain on a published lineup.
  const vacated = await releaseFromTeams(matchId, playerId);
  if (vacated.length) {
    await query(
      `INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after_value)
       VALUES ($1, $2, 'player_left_team', 'team', $3, $4)`,
      [orgId, playerId, vacated[0].team_id, JSON.stringify({ matchId, playerId, vacated })]
    );
  }
  await rebalanceRegistrationQueue(matchId);
  res.json(await getMatchBundle(matchId, false, orgId));
}));

// ---- Player-recorded results ----
// A player may record results only for a pitch they are actually on — checked
// here, not just hidden in the UI, same principle as the results/goals
// withheld from getMatchBundle above until an admin publishes them. This is
// deliberately separate from that shared bundle: it always shows the ONE
// pitch's own games regardless of match.status (as long as it's currently
// playable), without touching the broader "nothing leaks before publish"
// behavior everyone else's bundle relies on.
async function pitchForResultEntry(pitchId, user) {
  const { rows } = await query(
    `SELECT p.*, m.status AS match_status
     FROM pitches p JOIN matches m ON m.id = p.match_id
     WHERE p.id = $1 AND p.org_id = $2`,
    [pitchId, user.org_id]
  );
  const pitch = rows[0];
  if (!pitch) return null;
  // Only while the match is actually being (or was just) played — not before
  // lineups exist, and not once an admin has already published final stats.
  if (!["teams_published", "finished"].includes(pitch.match_status)) return null;
  if (requireRole(user, ["admin", "stats_admin"])) return pitch;
  const { rows: memberRows } = await query(
    `SELECT 1 FROM team_players tp JOIN teams t ON t.id = tp.team_id
     WHERE t.pitch_id = $1 AND tp.player_id = $2`,
    [pitchId, user.id]
  );
  return memberRows[0] ? pitch : null;
}

// The scoreline is never typed in — it's always exactly the goal_events
// count, recomputed after every add/remove so game_results.team_a_goals /
// team_b_goals (what everything else already reads) stays in sync.
async function recomputeGameScore(client, gameId) {
  const { rows: gameRows } = await client.query("SELECT team_a_id, team_b_id FROM game_results WHERE id = $1", [gameId]);
  const game = gameRows[0];
  if (!game) return null;
  const { rows: counts } = await client.query(
    "SELECT team_id, COUNT(*)::int AS goals FROM goal_events WHERE game_id = $1 GROUP BY team_id",
    [gameId]
  );
  const byTeam = Object.fromEntries(counts.map((row) => [row.team_id, row.goals]));
  const { rows } = await client.query(
    "UPDATE game_results SET team_a_goals = $2, team_b_goals = $3 WHERE id = $1 RETURNING *",
    [gameId, byTeam[game.team_a_id] || 0, byTeam[game.team_b_id] || 0]
  );
  return rows[0];
}

app.get("/api/pitches/:pitchId/games", asyncRoute(async (req, res) => {
  const { pitchId } = req.params;
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "נדרשת התחברות" });
  const pitch = await pitchForResultEntry(pitchId, user);
  if (!pitch) return res.status(403).json({ error: "אין הרשאה לתעד תוצאות למגרש הזה" });
  const [teams, games, goals] = await Promise.all([
    query(
      `SELECT t.id, t.color_name, t.color_hex,
        COALESCE(json_agg(json_build_object('id', p.id, 'full_name', p.full_name) ORDER BY p.full_name)
          FILTER (WHERE p.id IS NOT NULL), '[]') AS players
       FROM teams t
       LEFT JOIN team_players tp ON tp.team_id = t.id
       LEFT JOIN players p ON p.id = tp.player_id
       WHERE t.pitch_id = $1
       GROUP BY t.id, t.sort_order
       ORDER BY t.sort_order`,
      [pitchId]
    ),
    query("SELECT * FROM game_results WHERE pitch_id = $1 ORDER BY sort_order", [pitchId]),
    query(
      `SELECT ge.*, scorer.full_name AS scorer_name, assist.full_name AS assist_name
       FROM goal_events ge
       JOIN players scorer ON scorer.id = ge.scorer_id
       LEFT JOIN players assist ON assist.id = ge.assist_id
       WHERE ge.game_id IN (SELECT id FROM game_results WHERE pitch_id = $1)`,
      [pitchId]
    )
  ]);
  res.json({
    pitch: { id: pitch.id, label: pitch.label },
    match: { id: pitch.match_id, status: pitch.match_status },
    teams: teams.rows,
    games: games.rows,
    goals: goals.rows
  });
}));

app.post("/api/pitches/:pitchId/games", asyncRoute(async (req, res) => {
  const { pitchId } = req.params;
  const { teamAId, teamBId } = req.body;
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "נדרשת התחברות" });
  const pitch = await pitchForResultEntry(pitchId, user);
  if (!pitch) return res.status(403).json({ error: "אין הרשאה לתעד תוצאות למגרש הזה" });
  if (!teamAId || !teamBId || teamAId === teamBId) {
    return res.status(400).json({ error: "יש לבחור שתי קבוצות שונות" });
  }
  const { rows: teamRows } = await query(
    "SELECT id FROM teams WHERE pitch_id = $1 AND id = ANY($2::uuid[])",
    [pitchId, [teamAId, teamBId]]
  );
  if (teamRows.length !== 2) return res.status(400).json({ error: "הקבוצות חייבות להיות מהמגרש הזה" });
  const { rows: orderRows } = await query(
    "SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM game_results WHERE pitch_id = $1",
    [pitchId]
  );
  const { rows } = await query(
    `INSERT INTO game_results (org_id, pitch_id, team_a_id, team_b_id, sort_order)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [user.org_id, pitchId, teamAId, teamBId, orderRows[0].next_order]
  );
  await query(
    `INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after_value)
     VALUES ($1, $2, 'player_add_game', 'game', $3, $4)`,
    [user.org_id, user.id, rows[0].id, JSON.stringify(rows[0])]
  );
  res.status(201).json({ game: rows[0] });
}));

app.delete("/api/pitches/:pitchId/games/:gameId", asyncRoute(async (req, res) => {
  const { pitchId, gameId } = req.params;
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "נדרשת התחברות" });
  const pitch = await pitchForResultEntry(pitchId, user);
  if (!pitch) return res.status(403).json({ error: "אין הרשאה לתעד תוצאות למגרש הזה" });
  await query("DELETE FROM game_results WHERE id = $1 AND pitch_id = $2", [gameId, pitchId]);
  res.json({ ok: true });
}));

app.post("/api/pitches/:pitchId/games/:gameId/goals", asyncRoute(async (req, res) => {
  const { pitchId, gameId } = req.params;
  const { scorerId, assistId, ownGoal } = req.body;
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "נדרשת התחברות" });
  const pitch = await pitchForResultEntry(pitchId, user);
  if (!pitch) return res.status(403).json({ error: "אין הרשאה לתעד תוצאות למגרש הזה" });
  if (!scorerId) return res.status(400).json({ error: "יש לבחור כובש" });
  if (!ownGoal && assistId && assistId === scorerId) {
    return res.status(400).json({ error: "כובש לא יכול לבשל לעצמו" });
  }
  const { rows: gameRows } = await query("SELECT * FROM game_results WHERE id = $1 AND pitch_id = $2", [gameId, pitchId]);
  const game = gameRows[0];
  if (!game) return res.status(404).json({ error: "משחק לא נמצא" });
  // Which team the scorer is actually on, so an own goal credits the other side.
  const { rows: scorerTeamRows } = await query(
    "SELECT team_id FROM team_players WHERE player_id = $1 AND team_id = ANY($2::uuid[])",
    [scorerId, [game.team_a_id, game.team_b_id]]
  );
  const scorerTeamId = scorerTeamRows[0]?.team_id;
  if (!scorerTeamId) return res.status(400).json({ error: "הכובש חייב להיות באחת משתי הקבוצות" });
  const creditedTeamId = ownGoal
    ? (scorerTeamId === game.team_a_id ? game.team_b_id : game.team_a_id)
    : scorerTeamId;
  const { goal, updatedGame } = await withClient(async (client) => {
    const { rows: goalRows } = await client.query(
      `INSERT INTO goal_events (org_id, game_id, scorer_id, assist_id, team_id, own_goal)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [user.org_id, gameId, scorerId, ownGoal ? null : (assistId || null), creditedTeamId, Boolean(ownGoal)]
    );
    const updated = await recomputeGameScore(client, gameId);
    return { goal: goalRows[0], updatedGame: updated };
  });
  res.status(201).json({ goal, game: updatedGame });
}));

app.delete("/api/pitches/:pitchId/games/:gameId/goals/:goalId", asyncRoute(async (req, res) => {
  const { pitchId, gameId, goalId } = req.params;
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "נדרשת התחברות" });
  const pitch = await pitchForResultEntry(pitchId, user);
  if (!pitch) return res.status(403).json({ error: "אין הרשאה לתעד תוצאות למגרש הזה" });
  const updatedGame = await withClient(async (client) => {
    await client.query("DELETE FROM goal_events WHERE id = $1 AND game_id = $2", [goalId, gameId]);
    return recomputeGameScore(client, gameId);
  });
  res.json({ game: updatedGame });
}));

app.get("/api/players/:playerId/stats", asyncRoute(async (req, res) => {
  const { playerId } = req.params;
  const { rows: ownerRows } = await query("SELECT org_id FROM players WHERE id = $1", [playerId]);
  if (!ownerRows[0]) return res.status(404).json({ error: "שחקן לא נמצא" });
  const orgId = ownerRows[0].org_id;
  const [player, goals, assists, appearances, history] = await Promise.all([
    query(`SELECT ${playerFields} FROM players WHERE id = $1 AND org_id = $2`, [playerId, orgId]),
    query("SELECT COUNT(*)::int AS count FROM goal_events WHERE scorer_id = $1 AND org_id = $2", [playerId, orgId]),
    query("SELECT COUNT(*)::int AS count FROM goal_events WHERE assist_id = $1 AND org_id = $2", [playerId, orgId]),
    query("SELECT COUNT(*)::int AS count FROM team_players WHERE player_id = $1 AND org_id = $2", [playerId, orgId]),
    query(
      `SELECT m.title, m.match_date, pi.label, t.color_name, t.color_hex,
        COUNT(ge.id) FILTER (WHERE ge.scorer_id = $1)::int AS goals,
        COUNT(ge.id) FILTER (WHERE ge.assist_id = $1)::int AS assists
       FROM team_players tp
       JOIN teams t ON t.id = tp.team_id
       JOIN pitches pi ON pi.id = t.pitch_id
       JOIN matches m ON m.id = pi.match_id
       LEFT JOIN goal_events ge ON ge.team_id = t.id AND (ge.scorer_id = $1 OR ge.assist_id = $1)
       WHERE tp.player_id = $1 AND tp.org_id = $2
       GROUP BY m.title, m.match_date, pi.label, t.color_name, t.color_hex
       ORDER BY m.match_date DESC`,
      [playerId, orgId]
    )
  ]);
  res.json({
    player: player.rows[0],
    totals: {
      goals: goals.rows[0].count,
      assists: assists.rows[0].count,
      appearances: appearances.rows[0].count
    },
    history: history.rows
  });
}));

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error.message });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Badat API listening on http://0.0.0.0:${port}`);
});
