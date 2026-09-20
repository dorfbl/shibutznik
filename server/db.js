import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const config = process.env.PGHOST
  ? {
      host: process.env.PGHOST,
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD
    }
  : { connectionString: process.env.DATABASE_URL };

export const pool = new pg.Pool(config);

export async function query(sql, params = []) {
  const result = await pool.query(sql, params);
  return result;
}

export async function withClient(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
