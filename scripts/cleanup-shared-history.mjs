import { neon } from "@neondatabase/serverless";

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL;
if (!connectionString) throw new Error("Set DATABASE_URL before running shared-history cleanup.");

const sql = neon(connectionString);
const [expired, overflow, rateLimits] = await sql.transaction((transaction) => [
  transaction`DELETE FROM shared_history WHERE expires_at <= now() RETURNING id`,
  transaction`DELETE FROM shared_history
    WHERE id IN (
      SELECT id FROM shared_history
      ORDER BY created_at DESC, id DESC
      OFFSET 200
    )
    RETURNING id`,
  transaction`DELETE FROM shared_history_rate_limits
    WHERE window_start < now() - interval '2 hours'
    RETURNING network_hash`,
]);

console.log(JSON.stringify({
  expiredRecords: expired.length,
  overflowRecords: overflow.length,
  expiredRateLimits: rateLimits.length,
}));
