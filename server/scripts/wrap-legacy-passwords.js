// One-off: wrap every remaining unsalted SHA-256 password hash in bcrypt, so
// no fast-to-crack hash stays in the database while waiting for each player
// to log in again (login then upgrades them to plain bcrypt — see
// ../passwords.js). Safe to re-run: it only touches rows still in the
// 64-hex-character format, and checks each row is unchanged before writing.
//
//   node server/scripts/wrap-legacy-passwords.js
import { query } from "../db.js";
import { isLegacyHex, wrapLegacyHash } from "../passwords.js";

const { rows } = await query("SELECT id, password_hash FROM players WHERE password_hash ~ '^[0-9a-f]{64}$'");
let wrapped = 0;
for (const row of rows) {
  if (!isLegacyHex(row.password_hash)) continue;
  const result = await query(
    "UPDATE players SET password_hash = $1 WHERE id = $2 AND password_hash = $3",
    [await wrapLegacyHash(row.password_hash), row.id, row.password_hash]
  );
  wrapped += result.rowCount;
}
const { rows: left } = await query("SELECT COUNT(*)::int AS count FROM players WHERE password_hash ~ '^[0-9a-f]{64}$'");
console.log(`wrapped ${wrapped} of ${rows.length}; plain SHA-256 hashes left: ${left[0].count}`);
process.exit(0);
