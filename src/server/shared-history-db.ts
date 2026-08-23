import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { GenerationHistoryItem } from "../types";
import type { SharedHistoryPayload } from "../lib/shared-history-client";

type Sql = NeonQueryFunction<false, false>;

type SharedHistoryRow = {
  id: string;
  title: string;
  rota_date: string | Date;
  code: string;
  assignments: unknown;
  roster_revision: string;
  created_at: string | Date;
  updated_at: string | Date;
  expires_at: string | Date;
};

let sqlPromise: Promise<Sql> | null = null;

async function database(): Promise<Sql> {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL;
  if (!connectionString) throw new Error("shared-history-database-unconfigured");
  if (!sqlPromise) {
    sqlPromise = import("@neondatabase/serverless").then(({ neon }) => neon(connectionString));
  }
  return sqlPromise;
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function dateOnly(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function rowToHistoryItem(row: SharedHistoryRow): GenerationHistoryItem {
  const assignments = Array.isArray(row.assignments) ? row.assignments : [];
  return {
    id: row.id,
    title: row.title,
    date: dateOnly(row.rota_date),
    code: row.code,
    assignments: assignments as GenerationHistoryItem["assignments"],
    rosterRevision: row.roster_revision,
    savedAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    expiresAt: iso(row.expires_at),
    source: "shared",
    syncStatus: "shared",
  };
}

export type FeedCursor = { createdAt: string; id: string };

export function encodeFeedCursor(cursor: FeedCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeFeedCursor(value: string): FeedCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof parsed.createdAt !== "string" || !Number.isFinite(new Date(parsed.createdAt).getTime()) ||
        typeof parsed.id !== "string" || !/^[0-9a-f-]{36}$/i.test(parsed.id)) {
      throw new Error("invalid-cursor");
    }
    return { createdAt: new Date(parsed.createdAt).toISOString(), id: parsed.id };
  } catch {
    throw new Error("invalid-cursor");
  }
}

export async function listSharedHistory(options: {
  limit: number;
  cursor?: FeedCursor;
  query?: string;
}): Promise<{ items: GenerationHistoryItem[]; nextCursor: string | null }> {
  const sql = await database();
  const q = options.query?.trim() || "";
  let rows: SharedHistoryRow[];
  if (options.cursor && q) {
    rows = await sql.query(
      `SELECT id, title, rota_date, code, assignments, roster_revision, created_at, updated_at, expires_at
       FROM shared_history
       WHERE expires_at > now()
         AND (created_at, id) < ($1::timestamptz, $2::uuid)
         AND (title ILIKE $3 OR rota_date::text ILIKE $3)
       ORDER BY created_at DESC, id DESC
       LIMIT $4`,
      [options.cursor.createdAt, options.cursor.id, `%${q}%`, options.limit + 1],
    ) as SharedHistoryRow[];
  } else if (options.cursor) {
    rows = await sql.query(
      `SELECT id, title, rota_date, code, assignments, roster_revision, created_at, updated_at, expires_at
       FROM shared_history
       WHERE expires_at > now() AND (created_at, id) < ($1::timestamptz, $2::uuid)
       ORDER BY created_at DESC, id DESC
       LIMIT $3`,
      [options.cursor.createdAt, options.cursor.id, options.limit + 1],
    ) as SharedHistoryRow[];
  } else if (q) {
    rows = await sql.query(
      `SELECT id, title, rota_date, code, assignments, roster_revision, created_at, updated_at, expires_at
       FROM shared_history
       WHERE expires_at > now() AND (title ILIKE $1 OR rota_date::text ILIKE $1)
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      [`%${q}%`, options.limit + 1],
    ) as SharedHistoryRow[];
  } else {
    rows = await sql.query(
      `SELECT id, title, rota_date, code, assignments, roster_revision, created_at, updated_at, expires_at
       FROM shared_history
       WHERE expires_at > now()
       ORDER BY created_at DESC, id DESC
       LIMIT $1`,
      [options.limit + 1],
    ) as SharedHistoryRow[];
  }

  const hasMore = rows.length > options.limit;
  const visible = rows.slice(0, options.limit);
  const last = visible[visible.length - 1];
  return {
    items: visible.map(rowToHistoryItem),
    nextCursor: hasMore && last
      ? encodeFeedCursor({ createdAt: iso(last.created_at), id: last.id })
      : null,
  };
}

export async function createSharedHistory(
  payload: SharedHistoryPayload,
  editTokenHash: string,
): Promise<GenerationHistoryItem | null> {
  const sql = await database();
  const rows = await sql.query(
    `INSERT INTO shared_history (
       id, title, rota_date, code, assignments, roster_revision, edit_token_hash,
       created_at, updated_at, expires_at
     ) VALUES ($1::uuid, $2, $3::date, $4, $5::jsonb, $6, $7, $8::timestamptz, $9::timestamptz, $8::timestamptz + interval '90 days')
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       rota_date = EXCLUDED.rota_date,
       code = EXCLUDED.code,
       assignments = EXCLUDED.assignments,
       roster_revision = EXCLUDED.roster_revision,
       updated_at = EXCLUDED.updated_at
     WHERE shared_history.edit_token_hash = EXCLUDED.edit_token_hash
       AND shared_history.updated_at <= EXCLUDED.updated_at
     RETURNING id, title, rota_date, code, assignments, roster_revision, created_at, updated_at, expires_at`,
    [
      payload.id,
      payload.title,
      payload.date,
      payload.code,
      JSON.stringify(payload.assignments),
      payload.rosterRevision,
      editTokenHash,
      payload.savedAt,
      payload.updatedAt,
    ],
  ) as SharedHistoryRow[];
  return rows[0] ? rowToHistoryItem(rows[0]) : null;
}

export async function updateSharedHistory(
  id: string,
  payload: SharedHistoryPayload,
  editTokenHash: string,
): Promise<GenerationHistoryItem | null> {
  const sql = await database();
  const rows = await sql.query(
    `UPDATE shared_history SET
       title = $2,
       rota_date = $3::date,
       code = $4,
       assignments = $5::jsonb,
       roster_revision = $6,
       updated_at = $7::timestamptz
     WHERE id = $1::uuid AND edit_token_hash = $8 AND updated_at <= $7::timestamptz
     RETURNING id, title, rota_date, code, assignments, roster_revision, created_at, updated_at, expires_at`,
    [
      id,
      payload.title,
      payload.date,
      payload.code,
      JSON.stringify(payload.assignments),
      payload.rosterRevision,
      payload.updatedAt,
      editTokenHash,
    ],
  ) as SharedHistoryRow[];
  return rows[0] ? rowToHistoryItem(rows[0]) : null;
}

export async function consumeMutationQuota(networkHash: string): Promise<boolean> {
  const sql = await database();
  const rows = await sql.query(
    `INSERT INTO shared_history_rate_limits (network_hash, window_start, mutation_count)
     VALUES ($1, date_trunc('hour', now()), 1)
     ON CONFLICT (network_hash, window_start) DO UPDATE
       SET mutation_count = shared_history_rate_limits.mutation_count + 1
     RETURNING mutation_count`,
    [networkHash],
  ) as Array<{ mutation_count: number }>;
  return Number(rows[0]?.mutation_count || 0) <= 30;
}

export async function cleanSharedHistory(): Promise<void> {
  const sql = await database();
  await sql.transaction((transaction) => [
    transaction`DELETE FROM shared_history WHERE expires_at <= now()`,
    transaction`DELETE FROM shared_history
      WHERE id IN (
        SELECT id FROM shared_history
        ORDER BY created_at DESC, id DESC
        OFFSET 200
      )`,
    transaction`DELETE FROM shared_history_rate_limits WHERE window_start < now() - interval '2 hours'`,
  ]);
}
