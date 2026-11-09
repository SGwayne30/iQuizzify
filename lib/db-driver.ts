import fs from 'fs';
import path from 'path';
import { createClient } from '@libsql/client';
import { Pool } from 'pg';

/**
 * A tiny driver interface so lib/server-db.ts is written once and runs on
 * either Turso/SQLite (default) or Supabase Postgres. SQL is written with `?`
 * placeholders and only uses syntax both engines accept.
 *
 * Pick the backend with DB_PROVIDER=supabase. It is opt-in on purpose: the
 * Supabase env vars exist on Vercel already, and switching implicitly would
 * point production at an empty database.
 */
export type Row = Record<string, any>;
export interface Stmt {
  sql: string;
  args?: any[];
}
export interface Tx {
  execute(sql: string, args?: any[]): Promise<Row[]>;
}
export interface Driver {
  kind: 'turso' | 'supabase';
  execute(sql: string, args?: any[]): Promise<Row[]>;
  /** Runs statements atomically, in order. */
  batch(stmts: Stmt[]): Promise<void>;
  /** Runs `fn` inside one transaction; commits on success, rolls back on throw. */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

/** True when an insert failed because of the UNIQUE(assessment_id, email_norm) constraint. */
export function isUniqueViolation(err: any): boolean {
  return err?.code === '23505' || (typeof err?.message === 'string' && err.message.includes('UNIQUE constraint failed'));
}

// --- Turso / SQLite ---------------------------------------------------------

function tursoDriver(): Driver {
  // A dev DB created before the rename (Assessify -> iQuizify) is still data/assessify.db;
  // keep using it if it exists and the new filename doesn't yet.
  const localFile = !fs.existsSync('data/iquizify.db') && fs.existsSync('data/assessify.db') ? 'data/assessify.db' : 'data/iquizify.db';
  const url = process.env.TURSO_DATABASE_URL || `file:${localFile}`;
  if (!process.env.TURSO_DATABASE_URL && process.env.VERCEL) {
    // Fail loudly rather than quietly writing to a local file Vercel discards.
    throw new Error(
      '[iquizify] TURSO_DATABASE_URL is not set. On Vercel this app needs a Turso ' +
        'database (or DB_PROVIDER=supabase) — local SQLite files do not persist there. See README.md.'
    );
  }
  if (url.startsWith('file:')) {
    // libSQL's local-file mode won't create the parent directory itself.
    const dir = path.dirname(url.slice('file:'.length));
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  return {
    kind: 'turso',
    async execute(sql, args = []) {
      return (await client.execute({ sql, args })).rows as Row[];
    },
    async batch(stmts) {
      await client.batch(
        stmts.map((s) => ({ sql: s.sql, args: s.args ?? [] })),
        'write'
      );
    },
    async transaction(fn) {
      const tx = await client.transaction('write');
      try {
        const out = await fn({
          async execute(sql, args = []) {
            return (await tx.execute({ sql, args })).rows as Row[];
          },
        });
        await tx.commit();
        return out;
      } finally {
        tx.close();
      }
    },
  };
}

// --- Supabase (Postgres) ----------------------------------------------------

/** `?` -> `$1, $2, ...` (none of our SQL has a literal `?` inside a string). */
function toPg(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Arbitrary constant; serializes DDL so concurrent cold starts can't race on CREATE TABLE.
const SCHEMA_LOCK = 748392;

function supabaseDriver(): Driver {
  const raw = process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
  if (!raw) {
    throw new Error('[iquizify] DB_PROVIDER=supabase but no SUPABASE_DB_URL / POSTGRES_URL is set.');
  }
  // Strip the query string: pg treats `sslmode=require` as verify-full, which
  // rejects Supabase's pooler certificate. TLS is configured explicitly below.
  const connectionString = raw.split('?')[0];
  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    // One connection per serverless instance; Supabase's pooler does the fan-in.
    max: 1,
    idleTimeoutMillis: 10_000,
  });

  return {
    kind: 'supabase',
    async execute(sql, args = []) {
      return (await pool.query(toPg(sql), args)).rows;
    },
    async batch(stmts) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await c.query('SELECT pg_advisory_xact_lock($1)', [SCHEMA_LOCK]);
        for (const s of stmts) await c.query(toPg(s.sql), s.args ?? []);
        await c.query('COMMIT');
      } catch (err) {
        await c.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        c.release();
      }
    },
    async transaction(fn) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const out = await fn({
          async execute(sql, args = []) {
            return (await c.query(toPg(sql), args)).rows;
          },
        });
        await c.query('COMMIT');
        return out;
      } catch (err) {
        await c.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        c.release();
      }
    },
  };
}

let _driver: Driver | null = null;
export function getDriver(): Driver {
  if (_driver) return _driver;
  _driver = process.env.DB_PROVIDER === 'supabase' ? supabaseDriver() : tursoDriver();
  return _driver;
}
