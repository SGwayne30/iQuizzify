// One-time copy of the live Turso database into Supabase Postgres.
//
//   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... \
//   POSTGRES_URL=postgres://... node scripts/migrate-turso-to-supabase.js
//
// (`vercel env pull` gets you all of these.) It REPLACES what's in Supabase's
// meta/responses/presence tables with the Turso contents, in one transaction.
//
// Turso is only ever READ. Before anything is written, the Turso data is saved
// to backups/turso-<timestamp>.json, and after the copy the script checks that
// Supabase holds the same number of responses and byte-identical meta —
// if not, the transaction is rolled back and nothing changes in Supabase.
const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');
const { Pool } = require('pg');

async function main() {
  const { TURSO_DATABASE_URL, TURSO_AUTH_TOKEN } = process.env;
  const pgUrl = process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL;
  if (!TURSO_DATABASE_URL || !pgUrl) throw new Error('Set TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN) and POSTGRES_URL.');

  const turso = createClient({ url: TURSO_DATABASE_URL, authToken: TURSO_AUTH_TOKEN });
  const pool = new Pool({ connectionString: pgUrl.split('?')[0], ssl: { rejectUnauthorized: false }, max: 1 });

  const meta = (await turso.execute('SELECT * FROM meta WHERE id = 1')).rows[0];
  const responses = (await turso.execute('SELECT * FROM responses')).rows;
  if (!meta) throw new Error('Turso has no meta row — nothing to migrate.');
  console.log(`Turso: 1 meta row, ${responses.length} responses`);

  const dir = path.join(process.cwd(), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `turso-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify({ meta, responses }, null, 2));
  console.log(`Backup written: ${file}`);

  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    // Make sure the tables exist (same DDL the app runs on first request).
    await c.query(`CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY CHECK (id = 1), admin_accounts TEXT NOT NULL, field_options TEXT NOT NULL, assessments TEXT NOT NULL)`);
    await c.query(`CREATE TABLE IF NOT EXISTS responses (id TEXT PRIMARY KEY, assessment_id TEXT NOT NULL, email TEXT NOT NULL, email_norm TEXT NOT NULL, demographics TEXT NOT NULL, answers TEXT NOT NULL, total_score DOUBLE PRECISION NOT NULL, max_score DOUBLE PRECISION NOT NULL, correct_count INTEGER NOT NULL, total_questions INTEGER NOT NULL, submitted_at TEXT NOT NULL, UNIQUE(assessment_id, email_norm))`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_responses_assessment ON responses(assessment_id)`);
    await c.query(`CREATE TABLE IF NOT EXISTS presence (username TEXT PRIMARY KEY, assessment_id TEXT NOT NULL, assessment_title TEXT NOT NULL, action TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    for (const t of ['meta', 'responses', 'presence']) await c.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);

    await c.query('DELETE FROM responses');
    await c.query('DELETE FROM meta');
    await c.query('INSERT INTO meta (id, admin_accounts, field_options, assessments) VALUES (1, $1, $2, $3)', [
      meta.admin_accounts, meta.field_options, meta.assessments,
    ]);
    for (const r of responses) {
      await c.query(
        `INSERT INTO responses (id, assessment_id, email, email_norm, demographics, answers, total_score, max_score, correct_count, total_questions, submitted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [r.id, r.assessment_id, r.email, r.email_norm, r.demographics, r.answers, r.total_score, r.max_score, r.correct_count, r.total_questions, r.submitted_at]
      );
    }
    const count = Number((await c.query('SELECT COUNT(*) AS n FROM responses')).rows[0].n);
    const m = (await c.query('SELECT * FROM meta WHERE id = 1')).rows[0];
    const metaSame = m && m.admin_accounts === meta.admin_accounts && m.field_options === meta.field_options && m.assessments === meta.assessments;
    if (count !== responses.length || !metaSame) {
      throw new Error(`Verification failed (responses ${count}/${responses.length}, meta identical: ${!!metaSame}). Rolled back; Supabase unchanged.`);
    }
    await c.query('COMMIT');
    console.log(`Verified: Supabase has meta + ${count}/${responses.length} responses, identical to Turso.`);
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
    await pool.end();
    turso.close();
  }
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
