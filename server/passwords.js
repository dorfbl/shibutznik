import crypto from "node:crypto";
import bcrypt from "bcryptjs";

// Password storage. Three formats can be found in players.password_hash:
//
//   "$2a$..." / "$2b$..."    bcrypt(password)               — current
//   "sha256+bcrypt:$2..."    bcrypt(sha256(phone:password)) — old hashes,
//                            wrapped in place by scripts/wrap-legacy-passwords.js
//   64 hex characters        sha256(phone:password)         — the original
//                            unsalted format, until wrapped
//
// Either older format verifies by recomputing the old SHA-256 first, and is
// upgraded to plain bcrypt(password) the next time that player logs in
// (the only moment the server sees the password itself).

export const BCRYPT_ROUNDS = 12;
export const WRAPPED_PREFIX = "sha256+bcrypt:";
const LEGACY_HEX = /^[0-9a-f]{64}$/;

// The original scheme, salted only with the phone string stored on the row.
export function legacySha256(phone, password) {
  return crypto.createHash("sha256").update(`${phone}:${password}`).digest("hex");
}

export function hashPassword(password) {
  return bcrypt.hash(String(password), BCRYPT_ROUNDS);
}

export async function wrapLegacyHash(hexHash) {
  return WRAPPED_PREFIX + await bcrypt.hash(hexHash, BCRYPT_ROUNDS);
}

export function isLegacyHex(stored) {
  return LEGACY_HEX.test(String(stored || ""));
}

// { ok, needsUpgrade } — needsUpgrade is true when the stored hash is in one
// of the older formats and should be replaced with bcrypt(password).
export async function verifyPassword(phone, password, stored) {
  const value = String(stored || "");
  const given = String(password ?? "");
  if (value.startsWith("$2")) {
    return { ok: await bcrypt.compare(given, value), needsUpgrade: false };
  }
  if (value.startsWith(WRAPPED_PREFIX)) {
    const ok = await bcrypt.compare(legacySha256(phone, given), value.slice(WRAPPED_PREFIX.length));
    return { ok, needsUpgrade: ok };
  }
  if (LEGACY_HEX.test(value)) {
    const expected = Buffer.from(value);
    const actual = Buffer.from(legacySha256(phone, given));
    const ok = crypto.timingSafeEqual(expected, actual);
    return { ok, needsUpgrade: ok };
  }
  return { ok: false, needsUpgrade: false };
}
