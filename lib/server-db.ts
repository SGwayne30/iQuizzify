import { getDriver, isUniqueViolation, type Driver, type Row } from './db-driver';
import { hashPassword, isHashed } from './password';
import crypto from 'crypto';
import type {
  DB,
  CustomField,
  ResponseRecord,
  ArchivedResponse,
  PresenceEntry,
  TabSwitchEvent,
  ProctorStatus,
  ProctorStatusName,
} from './types';
import seedData from './seed.json';
import { DEFAULT_GENDER, DEFAULT_CIVIL_STATUS, DEFAULT_SECTOR, DEFAULT_CATEGORY } from './field-defaults';

/**
 * Canonicalizes a registration email for dedup purposes.
 *
 * Gmail treats dots and plus-tags in the local part as aliases of the same
 * account, so those are stripped only for @gmail.com addresses. Other
 * allowed domains (e.g. deped.gov.ph work emails) are just trimmed and
 * lowercased — dot/plus-stripping isn't a real alias rule for those mail
 * systems and would incorrectly merge distinct addresses.
 */
export function normalizeEmailAddress(email: string): string {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf('@');
  if (at < 0 || normalized.slice(at + 1) !== 'gmail.com') return normalized;
  const local = normalized.slice(0, at).split('+', 1)[0].replace(/\./g, '');
  return `${local}@gmail.com`;
}

/** @deprecated kept as an alias so any external/legacy callers don't break — use normalizeEmailAddress. */
export const normalizeGmailAddress = normalizeEmailAddress;

// --- Connection -------------------------------------------------------
//
// The actual database driver lives in lib/db-driver.ts. By default that's
// Turso (libSQL/SQLite; falls back to a local file for development). Set
// DB_PROVIDER=supabase to use Supabase Postgres instead (SUPABASE_DB_URL or
// POSTGRES_URL). Every query below is plain SQL that runs on both.
/** Default text for the disclaimer shown right after a participant enters a valid access code. */
export const DEFAULT_DISCLAIMER =
  'This assessment platform is intended only to test and gauge your current knowledge and skills. ' +
  'It is not a certification exam and carries no penalty for incorrect answers. Your responses are ' +
  'used solely for training and development purposes, so please answer honestly and to the best of ' +
  'your own ability without outside help.';

const FALLBACK_META = {
  adminAccounts: [{ id: 'admin_default', username: 'admin', password: 'admin123', role: 'super' as const }],
  fieldOptions: {
    sex: ['Male', 'Female', 'Intersex'],
    gender: [...DEFAULT_GENDER],
    civilStatus: [...DEFAULT_CIVIL_STATUS],
    region: [
      'NCR (National Capital Region)',
      'CAR (Cordillera Administrative Region)',
      'Region I (Ilocos Region)',
      'Region II (Cagayan Valley)',
      'Region III (Central Luzon)',
      'Region IV-A (CALABARZON)',
      'Region IV-B (MIMAROPA)',
      'Region V (Bicol Region)',
      'Region VI (Western Visayas)',
      'Region VII (Central Visayas)',
      'Region VIII (Eastern Visayas)',
      'Region IX (Zamboanga Peninsula)',
      'Region X (Northern Mindanao)',
      'Region XI (Davao Region)',
      'Region XII (SOCCSKSARGEN)',
      'Region XIII (Caraga)',
      'BARMM (Bangsamoro Autonomous Region in Muslim Mindanao)',
    ],
    age: ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'],
    sector: [...DEFAULT_SECTOR],
    category: [...DEFAULT_CATEGORY],
    courses: [] as string[],
    subjects: [] as string[],
    registrationMode: 'simple' as 'simple' | 'full',
    customFields: [] as CustomField[],
    disclaimer: DEFAULT_DISCLAIMER,
  },
  assessments: [] as any[],
};

function normalizeAccounts(raw: any): DB['adminAccounts'] {
  let accounts = Array.isArray(raw) && raw.length > 0 ? raw : FALLBACK_META.adminAccounts;
  accounts = accounts.map((a: any, i: number) => ({
    ...a,
    role: a.role === 'super' || a.role === 'admin' ? a.role : i === 0 ? 'super' : 'admin',
  }));
  if (!accounts.some((a: any) => a.role === 'super')) accounts[0] = { ...accounts[0], role: 'super' };
  return accounts;
}

function normalizeFieldOptions(raw: any): DB['fieldOptions'] {
  const fo = { ...FALLBACK_META.fieldOptions, ...(raw ?? {}) };
  if (!Array.isArray(fo.sex) || fo.sex.length === 0) fo.sex = FALLBACK_META.fieldOptions.sex;
  if (!Array.isArray(fo.gender) || fo.gender.length === 0) fo.gender = FALLBACK_META.fieldOptions.gender;
  // Older/imported DBs won't have these two keys at all — default them in
  // rather than requiring a SQL migration, since fieldOptions is just a
  // JSON blob under the hood.
  if (!Array.isArray(fo.civilStatus) || fo.civilStatus.length === 0) fo.civilStatus = FALLBACK_META.fieldOptions.civilStatus;
  if (!Array.isArray(fo.region) || fo.region.length === 0) fo.region = FALLBACK_META.fieldOptions.region;
  fo.customFields = Array.isArray(fo.customFields)
    ? fo.customFields
        .filter((f: any) => f && typeof f.label === 'string' && f.label.trim())
        .map((f: any): CustomField => {
          const isText = f.type === 'text';
          return {
            id: typeof f.id === 'string' && f.id ? f.id : `field_${Math.random().toString(36).slice(2, 9)}`,
            label: String(f.label).trim(),
            type: isText ? 'text' : 'dropdown',
            options: !isText && Array.isArray(f.options) ? f.options.filter((o: any) => typeof o === 'string' && o.trim()) : [],
            ...(isText
              ? {
                  size: f.size === 'long' ? ('long' as const) : ('short' as const),
                  placeholder: typeof f.placeholder === 'string' ? f.placeholder.trim() : '',
                }
              : {}),
          };
        })
    : [];
  for (const key of ['courses', 'subjects'] as const) {
    fo[key] = Array.isArray(fo[key])
      ? fo[key].filter((o: any) => typeof o === 'string' && o.trim()).map((o: string) => o.trim())
      : [];
  }
  fo.registrationMode = fo.registrationMode === 'full' ? 'full' : 'simple';
  fo.disclaimer = typeof fo.disclaimer === 'string' && fo.disclaimer.trim() ? fo.disclaimer : FALLBACK_META.fieldOptions.disclaimer;
  return fo;
}

// --- Schema + seeding ---------------------------------------------------
//
// libSQL clients are stateless/async (no persistent open handle to guard),
// so instead of a module-level "is this the first time?" flag we just make
// sure the schema exists and seed the meta row if it's missing, every time
// getDb() is called. CREATE TABLE IF NOT EXISTS and the `hasMeta` check
// below make that safe to repeat on every request.
let schemaReady: Promise<void> | null = null;
async function ensureSchema(db: Driver) {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.batch(
        [
          `CREATE TABLE IF NOT EXISTS app_secrets (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
          )`,
          `CREATE TABLE IF NOT EXISTS meta (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            admin_accounts TEXT NOT NULL,
            field_options TEXT NOT NULL,
            assessments TEXT NOT NULL
          )`,
          `CREATE TABLE IF NOT EXISTS responses (
            id TEXT PRIMARY KEY,
            assessment_id TEXT NOT NULL,
            email TEXT NOT NULL,
            email_norm TEXT NOT NULL,
            demographics TEXT NOT NULL,
            answers TEXT NOT NULL,
            total_score DOUBLE PRECISION NOT NULL,
            max_score DOUBLE PRECISION NOT NULL,
            correct_count INTEGER NOT NULL,
            total_questions INTEGER NOT NULL,
            submitted_at TEXT NOT NULL,
            UNIQUE(assessment_id, email_norm)
          )`,
          `CREATE INDEX IF NOT EXISTS idx_responses_assessment ON responses(assessment_id)`,
          // Responses an admin removed. Same columns as `responses` plus who/when, and deliberately no
          // UNIQUE constraint: the respondent's slot in `responses` is free again (they may resubmit), and
          // recovering checks for that clash explicitly.
          `CREATE TABLE IF NOT EXISTS archived_responses (
            id TEXT PRIMARY KEY,
            assessment_id TEXT NOT NULL,
            email TEXT NOT NULL,
            email_norm TEXT NOT NULL,
            demographics TEXT NOT NULL,
            answers TEXT NOT NULL,
            total_score DOUBLE PRECISION NOT NULL,
            max_score DOUBLE PRECISION NOT NULL,
            correct_count INTEGER NOT NULL,
            total_questions INTEGER NOT NULL,
            submitted_at TEXT NOT NULL,
            archived_at TEXT NOT NULL,
            archived_by TEXT
          )`,
          `CREATE INDEX IF NOT EXISTS idx_archived_responses_assessment ON archived_responses(assessment_id)`,
          `CREATE TABLE IF NOT EXISTS presence (
            username TEXT PRIMARY KEY,
            assessment_id TEXT NOT NULL,
            assessment_title TEXT NOT NULL,
            action TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )`,
          `CREATE TABLE IF NOT EXISTS tab_switch_events (
            assessment_id TEXT NOT NULL,
            email_norm TEXT NOT NULL,
            email TEXT NOT NULL,
            full_name TEXT,
            assessment_title TEXT NOT NULL,
            switch_count INTEGER NOT NULL,
            first_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (assessment_id, email_norm)
          )`,
          `CREATE TABLE IF NOT EXISTS proctor_actions (
            assessment_id TEXT NOT NULL,
            email_norm TEXT NOT NULL,
            email TEXT NOT NULL,
            status TEXT NOT NULL,
            warnings INTEGER NOT NULL DEFAULT 0,
            message TEXT,
            warning_seq INTEGER NOT NULL DEFAULT 0,
            issued_by TEXT,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (assessment_id, email_norm)
          )`,
        ]
          // Supabase exposes every public-schema table to its REST API via the
          // anon key. RLS with no policies locks that door (this app connects
          // straight to Postgres as the owner role, which bypasses RLS) — vital
          // because `meta` holds admin credentials.
          .concat(
            db.kind === 'supabase'
              ? ['meta', 'responses', 'archived_responses', 'presence', 'tab_switch_events', 'proctor_actions'].map((t) => `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`)
              : []
          )
          .map((sql) => ({ sql }))
      );

      // `responses` predates `tab_switch_count`; add it on databases created before
      // proctoring existed. Fails harmlessly once the column is there.
      try {
        await db.execute('ALTER TABLE responses ADD COLUMN tab_switch_count INTEGER NOT NULL DEFAULT 0');
      } catch {
        // Column already exists — fine.
      }

      const hasMeta = await db.execute('SELECT 1 FROM meta WHERE id = 1');
      if (hasMeta.length === 0) {
        await seedFresh(db);
      }
    })();
  }
  return schemaReady;
}

async function getDb(): Promise<Driver> {
  const db = getDriver();
  await ensureSchema(db);
  return db;
}

async function seedFresh(db: Driver) {
  const seed: any = seedData ?? {};
  await db.execute(`INSERT INTO meta (id, admin_accounts, field_options, assessments) VALUES (1, ?, ?, ?) ON CONFLICT DO NOTHING`, [
    JSON.stringify(normalizeAccounts(seed.adminAccounts)),
    JSON.stringify(normalizeFieldOptions(seed.fieldOptions)),
    JSON.stringify(Array.isArray(seed.assessments) ? seed.assessments : []),
  ]);
  const responses = Array.isArray(seed.responses) ? seed.responses : [];
  await insertResponsesBulk(db, responses);
}

async function insertResponsesBulk(db: Driver, responses: any[]) {
  if (responses.length === 0) return;
  const stmts = responses.map((r) => {
    const email = r?.demographics?.email || '';
    const normalized = normalizeGmailAddress(email);
    // Historical/demo rows from before the Gmail requirement existed have
    // a blank email. Treating all of them as the same key would collapse
    // them into "duplicates" of each other under the uniqueness
    // constraint, so give each blank-email row its own synthetic key
    // (scoped with a prefix no real Gmail address could ever match) —
    // real emails still dedupe against each other normally.
    const emailNorm = normalized || `__legacy__:${r.id}`;
    return {
      sql: `INSERT INTO responses
        (id, assessment_id, email, email_norm, demographics, answers, total_score, max_score, correct_count, total_questions, submitted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT DO NOTHING`,
      args: [
        r.id,
        r.assessmentId,
        email,
        emailNorm,
        JSON.stringify(r.demographics ?? {}),
        JSON.stringify(r.answers ?? []),
        r.totalScore ?? 0,
        r.maxScore ?? 0,
        r.correctCount ?? 0,
        r.totalQuestions ?? 0,
        r.submittedAt || new Date().toISOString(),
      ],
    };
  });
  await db.batch(stmts);
}

function rowToResponse(row: Row): ResponseRecord {
  return {
    id: row.id,
    assessmentId: row.assessment_id,
    demographics: JSON.parse(row.demographics),
    answers: JSON.parse(row.answers),
    totalScore: row.total_score,
    maxScore: row.max_score,
    correctCount: row.correct_count,
    totalQuestions: row.total_questions,
    submittedAt: row.submitted_at,
    tabSwitchCount: row.tab_switch_count ?? 0,
  };
}

function rowToArchived(row: Row): ArchivedResponse {
  return {
    ...rowToResponse(row),
    archivedAt: row.archived_at,
    archivedBy: row.archived_by ? String(row.archived_by) : undefined,
  };
}

/** Full-DB read, shaped exactly like the old JSON store — used by the admin dashboard. */
export async function readServerDB(): Promise<DB> {
  const db = await getDb();
  const meta = (await db.execute('SELECT * FROM meta WHERE id = 1'))[0];
  const responsesRows = await db.execute('SELECT * FROM responses ORDER BY submitted_at ASC');
  const archivedRows = await db.execute('SELECT * FROM archived_responses ORDER BY archived_at DESC');
  return {
    // Password hashes never leave the server.
    adminAccounts: normalizeAccounts(JSON.parse(meta.admin_accounts as string)).map((a) => ({
      id: a.id,
      username: a.username,
      role: a.role,
    })),
    fieldOptions: normalizeFieldOptions(JSON.parse(meta.field_options as string)),
    assessments: JSON.parse(meta.assessments as string),
    responses: responsesRows.map(rowToResponse),
    archivedResponses: archivedRows.map(rowToArchived),
  };
}

/**
 * What a student's browser may see: registration options and the active assessments. No
 * responses, no archive, no admin accounts.
 */
export async function readPublicDB(): Promise<DB> {
  const db = await getDb();
  const meta = (await db.execute('SELECT * FROM meta WHERE id = 1'))[0];
  const assessments = (JSON.parse(meta.assessments as string) as DB['assessments']).filter(
    (a) => a.status === 'active'
  );
  return {
    adminAccounts: [],
    fieldOptions: normalizeFieldOptions(JSON.parse(meta.field_options as string)),
    assessments,
    responses: [],
    archivedResponses: [],
  };
}

/**
 * Full-DB write. Admin accounts / field options / assessments are replaced
 * outright (they're small, admin-edited blobs). The responses array is
 * treated as the desired end state — rows present get upserted, rows no
 * longer present get deleted — which supports the admin's bulk-delete flow
 * without needing a dedicated endpoint for it.
 */
export async function writeServerDB(next: DB) {
  const db = await getDb();

  await db.transaction(async (tx) => {
    // Admin accounts are deliberately NOT written here: they change only through /api/accounts.
    await tx.execute(`UPDATE meta SET field_options = ?, assessments = ? WHERE id = 1`, [
      JSON.stringify(normalizeFieldOptions(next.fieldOptions)),
      JSON.stringify(next.assessments ?? []),
    ]);

    // A stale browser copy can still list a response that has since been archived. Never let a full-DB
    // save bring it back (that would leave it in both places), so ids in the archive are dropped here.
    const archivedIds = new Set((await tx.execute('SELECT id FROM archived_responses')).map((r) => String(r.id)));
    const incoming = (next.responses ?? []).filter((r) => !archivedIds.has(r.id));

    // When an assessment is deleted for good, its archived responses have nowhere to be recovered to.
    const assessmentIds = (next.assessments ?? []).map((a) => a.id);
    if (assessmentIds.length > 0) {
      await tx.execute(
        `DELETE FROM archived_responses WHERE assessment_id NOT IN (${assessmentIds.map(() => '?').join(',')})`,
        assessmentIds
      );
    } else {
      await tx.execute('DELETE FROM archived_responses');
    }

    const keepIds = incoming.map((r) => r.id);
    if (keepIds.length > 0) {
      const placeholders = keepIds.map(() => '?').join(',');
      await tx.execute(`DELETE FROM responses WHERE id NOT IN (${placeholders})`, keepIds);
    } else {
      await tx.execute('DELETE FROM responses');
    }

    // ON CONFLICT DO NOTHING keeps existing rows as-is; done inline (rather than
    // reusing insertResponsesBulk) so every statement runs on this same
    // transaction instead of opening a separate implicit one.
    for (const r of incoming) {
      const email = (r as any)?.demographics?.email || '';
      const normalized = normalizeGmailAddress(email);
      const emailNorm = normalized || `__legacy__:${r.id}`;
      await tx.execute(
        `INSERT INTO responses
          (id, assessment_id, email, email_norm, demographics, answers, total_score, max_score, correct_count, total_questions, submitted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT DO NOTHING`,
        [
          r.id,
          r.assessmentId,
          email,
          emailNorm,
          JSON.stringify(r.demographics ?? {}),
          JSON.stringify(r.answers ?? []),
          r.totalScore ?? 0,
          r.maxScore ?? 0,
          r.correctCount ?? 0,
          r.totalQuestions ?? 0,
          r.submittedAt || new Date().toISOString(),
        ]
      );
    }
  });
}

/** Looks up an existing response by canonical email account, read-only. */
/** One assessment (with its answer key) straight from the stored list, without loading every response. */
export async function getAssessmentById(id: string): Promise<DB['assessments'][number] | null> {
  const db = await getDb();
  const meta = (await db.execute('SELECT assessments FROM meta WHERE id = 1'))[0];
  if (!meta) return null;
  const list = JSON.parse(meta.assessments as string) as DB['assessments'];
  return list.find((a) => a.id === id) ?? null;
}

export async function findResponse(assessmentId: string, email: string): Promise<ResponseRecord | null> {
  const db = await getDb();
  const emailNorm = normalizeGmailAddress(email);
  const result = await db.execute('SELECT * FROM responses WHERE assessment_id = ? AND email_norm = ?', [assessmentId, emailNorm]);
  if (result.length > 0) return rowToResponse(result[0]);

  // Recognize rows written before email alias normalization was added.
  const legacyRows = await db.execute('SELECT * FROM responses WHERE assessment_id = ?', [assessmentId]);
  const matchingRow = legacyRows.find((row) => normalizeGmailAddress(String(row.email || '')) === emailNorm);
  return matchingRow ? rowToResponse(matchingRow) : null;
}

/**
 * Atomically inserts a new response. The UNIQUE(assessment_id, email_norm)
 * constraint means the database itself — not application code — is what
 * guarantees an email address can't submit twice, even if two requests land
 * at the exact same moment.
 */
export async function insertResponseIfNew(
  record: ResponseRecord
): Promise<{ inserted: true; record: ResponseRecord } | { inserted: false; record: ResponseRecord }> {
  const db = await getDb();
  const emailNorm = normalizeGmailAddress(record.demographics.email || '');
  const existing = await findResponse(record.assessmentId, record.demographics.email || '');
  if (existing) return { inserted: false, record: existing };
  try {
    await db.execute(
      `INSERT INTO responses
        (id, assessment_id, email, email_norm, demographics, answers, total_score, max_score, correct_count, total_questions, submitted_at, tab_switch_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.assessmentId,
        record.demographics.email,
        emailNorm,
        JSON.stringify(record.demographics),
        JSON.stringify(record.answers),
        record.totalScore,
        record.maxScore,
        record.correctCount,
        record.totalQuestions,
        record.submittedAt,
        record.tabSwitchCount ?? 0,
      ]
    );
    return { inserted: true, record };
  } catch (err: any) {
    if (isUniqueViolation(err)) {
      const existing = await findResponse(record.assessmentId, record.demographics.email);
      if (existing) return { inserted: false, record: existing };
    }
    throw err;
  }
}

/**
 * The admin accounts with their password hashes. Any account still holding a plain-text
 * password (older installs, or the seeded default) is hashed and saved on the way through.
 */
export async function getAdminAccountsMigrated(): Promise<DB['adminAccounts']> {
  const db = await getDb();
  const result = await db.execute('SELECT admin_accounts FROM meta WHERE id = 1');
  const accounts = normalizeAccounts(JSON.parse(result[0].admin_accounts as string));
  if (accounts.some((a) => !isHashed(a.password ?? ''))) {
    const upgraded = accounts.map((a) => (isHashed(a.password ?? '') ? a : { ...a, password: hashPassword(a.password ?? '') }));
    await db.execute('UPDATE meta SET admin_accounts = ? WHERE id = 1', [JSON.stringify(upgraded)]);
    return upgraded;
  }
  return accounts;
}

export async function saveAdminAccounts(accounts: DB['adminAccounts']): Promise<void> {
  const db = await getDb();
  await db.execute('UPDATE meta SET admin_accounts = ? WHERE id = 1', [JSON.stringify(normalizeAccounts(accounts))]);
}

let cachedSecret: string | null = null;

/** Key used to sign admin session cookies: AUTH_SECRET if set, otherwise generated once and stored in the database. */
export async function getAuthSecret(): Promise<string> {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (cachedSecret) return cachedSecret;
  const db = await getDb();
  const read = async () => (await db.execute("SELECT value FROM app_secrets WHERE key = 'auth_secret'"))[0]?.value as string | undefined;
  let value = await read();
  if (!value) {
    await db.execute("INSERT INTO app_secrets (key, value) VALUES ('auth_secret', ?) ON CONFLICT DO NOTHING", [
      crypto.randomBytes(32).toString('hex'),
    ]);
    value = await read();
  }
  cachedSecret = value as string;
  return cachedSecret;
}

// --- Presence (live "who's editing what") -------------------------------
//
// A row is considered live only while it's newer than PRESENCE_TTL_MS.
// The client heartbeats every few seconds while an AssessmentModal is
// open, so a stale row just means that admin's tab was closed, crashed,
// or lost network — we don't need an explicit "I'm done" signal for
// correctness, only as a nicety to make the badge disappear promptly.
const PRESENCE_TTL_MS = 12_000;

function rowToPresence(row: any): PresenceEntry {
  return {
    username: row.username,
    assessmentId: row.assessment_id,
    assessmentTitle: row.assessment_title,
    action: row.action === 'creating' ? 'creating' : 'editing',
    updatedAt: row.updated_at,
  };
}

/** Upserts this admin's current "I'm working on X" heartbeat. */
export async function upsertPresence(entry: {
  username: string;
  assessmentId: string;
  assessmentTitle: string;
  action: 'creating' | 'editing';
}) {
  const db = await getDb();
  await db.execute(
    `INSERT INTO presence (username, assessment_id, assessment_title, action, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
        assessment_id = excluded.assessment_id,
        assessment_title = excluded.assessment_title,
        action = excluded.action,
        updated_at = excluded.updated_at`,
    [entry.username, entry.assessmentId, entry.assessmentTitle, entry.action, new Date().toISOString()]
  );
}

/** Clears this admin's heartbeat (called when the modal closes/saves — best-effort, not required for correctness). */
export async function clearPresence(username: string) {
  const db = await getDb();
  await db.execute('DELETE FROM presence WHERE username = ?', [username]);
}

/** Returns every still-live presence row, pruning stale ones first so the table doesn't grow unbounded. */
export async function listPresence(): Promise<PresenceEntry[]> {
  const db = await getDb();
  const cutoff = new Date(Date.now() - PRESENCE_TTL_MS).toISOString();
  await db.execute('DELETE FROM presence WHERE updated_at < ?', [cutoff]);
  return (await db.execute('SELECT * FROM presence')).map(rowToPresence);
}

// --- Removed responses: archive / recover / purge -------------------------
//
// "Removing" a response moves its row into archived_responses (nothing is lost), "recovering" moves it
// back into responses under the same assessment, and "purging" deletes it for good. Each operation runs
// in one transaction, so a response is always in exactly one of the two tables.

const RESPONSE_COLUMNS =
  'id, assessment_id, email, email_norm, demographics, answers, total_score, max_score, correct_count, total_questions, submitted_at';

function responseArgs(row: Row) {
  return [
    row.id,
    row.assessment_id,
    row.email,
    row.email_norm,
    row.demographics,
    row.answers,
    row.total_score,
    row.max_score,
    row.correct_count,
    row.total_questions,
    row.submitted_at,
  ];
}

const RESPONSE_PLACEHOLDERS = '?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?';

async function readAssessmentMeta(db: Driver): Promise<Map<string, { exported: boolean }>> {
  const meta = (await db.execute('SELECT assessments FROM meta WHERE id = 1'))[0];
  const list = meta ? (JSON.parse(meta.assessments as string) as Array<{ id: string; exported?: boolean }>) : [];
  return new Map(list.map((a) => [a.id, { exported: Boolean(a.exported) }]));
}

/** Moves responses out of their assessment and into the archive. Unknown ids are ignored. */
export async function archiveResponses(ids: string[], archivedBy?: string): Promise<{ archived: number }> {
  const db = await getDb();
  const now = new Date().toISOString();
  let archived = 0;
  await db.transaction(async (tx) => {
    for (const id of new Set(ids)) {
      const row = (await tx.execute('SELECT * FROM responses WHERE id = ?', [id]))[0];
      if (!row) continue;
      await tx.execute(
        `INSERT INTO archived_responses (${RESPONSE_COLUMNS}, archived_at, archived_by)
          VALUES (${RESPONSE_PLACEHOLDERS}, ?, ?)
          ON CONFLICT DO NOTHING`,
        [...responseArgs(row), now, archivedBy ?? null]
      );
      await tx.execute('DELETE FROM responses WHERE id = ?', [id]);
      archived += 1;
    }
  });
  return { archived };
}

export type RecoverSkipReason = 'not-found' | 'assessment-missing' | 'already-resubmitted';

/**
 * Puts archived responses back into the assessment they came from. A response is skipped (and stays in
 * the archive) if its assessment no longer exists, or if that respondent has submitted again in the
 * meantime, because restoring it would create a second response for the same email.
 */
export async function recoverResponses(
  ids: string[]
): Promise<{ recovered: number; skipped: Array<{ id: string; reason: RecoverSkipReason }> }> {
  const db = await getDb();
  const assessments = await readAssessmentMeta(db);
  const skipped: Array<{ id: string; reason: RecoverSkipReason }> = [];
  let recovered = 0;

  await db.transaction(async (tx) => {
    for (const id of new Set(ids)) {
      const row = (await tx.execute('SELECT * FROM archived_responses WHERE id = ?', [id]))[0];
      if (!row) {
        skipped.push({ id, reason: 'not-found' });
        continue;
      }
      if (!assessments.has(String(row.assessment_id))) {
        skipped.push({ id, reason: 'assessment-missing' });
        continue;
      }
      const clash = await tx.execute('SELECT id FROM responses WHERE assessment_id = ? AND email_norm = ?', [
        row.assessment_id,
        row.email_norm,
      ]);
      if (clash.length > 0) {
        skipped.push({ id, reason: 'already-resubmitted' });
        continue;
      }
      await tx.execute(`INSERT INTO responses (${RESPONSE_COLUMNS}) VALUES (${RESPONSE_PLACEHOLDERS})`, responseArgs(row));
      await tx.execute('DELETE FROM archived_responses WHERE id = ?', [id]);
      recovered += 1;
    }
  });
  return { recovered, skipped };
}

/**
 * Permanently deletes archived responses. Follows the same rule as deleting an assessment: the
 * assessment's responses must have been exported first, otherwise they are reported as blocked.
 */
export async function purgeArchivedResponses(ids: string[]): Promise<{ purged: number; blocked: string[] }> {
  const db = await getDb();
  const assessments = await readAssessmentMeta(db);
  const blocked: string[] = [];
  let purged = 0;

  await db.transaction(async (tx) => {
    for (const id of new Set(ids)) {
      const row = (await tx.execute('SELECT assessment_id FROM archived_responses WHERE id = ?', [id]))[0];
      if (!row) continue;
      const assessment = assessments.get(String(row.assessment_id));
      if (assessment && !assessment.exported) {
        blocked.push(id);
        continue;
      }
      await tx.execute('DELETE FROM archived_responses WHERE id = ?', [id]);
      purged += 1;
    }
  });
  return { purged, blocked };
}

// --- Tab-switch events (live "this respondent just alt-tabbed") ---------
//
// Unlike presence's TTL, a row here should NOT expire just because a few
// minutes passed with no new switch — the respondent may simply be reading
// a question. Rows are cleared explicitly once the respondent submits, and
// only pruned by age as a safety net for abandoned sessions (browser closed
// mid-quiz, never submitted) so the table doesn't grow forever.
const TAB_EVENT_ABANDONED_MS = 12 * 60 * 60 * 1000; // 12 hours

/**
 * How many tab switches trigger an automatic warning. The rule fires at
 * every multiple of this number (5th, 10th, 15th switch…) rather than only
 * the first time, so a respondent who keeps switching after being warned
 * keeps hearing about it — and the admin sees the warning count climb.
 */
export const AUTO_WARN_EVERY = 5;

function rowToTabSwitchEvent(row: Row): TabSwitchEvent {
  return {
    assessmentId: row.assessment_id,
    assessmentTitle: row.assessment_title,
    email: row.email,
    fullName: row.full_name || undefined,
    count: Number(row.switch_count),
    firstAt: row.first_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Records one detected tab/window switch, incrementing the count for this
 * respondent+assessment. Returns the new count plus the automatic warning,
 * if this switch happened to be the one that crossed the threshold — the
 * participant's app shows that immediately instead of waiting for its next
 * status poll.
 */
export async function recordTabSwitch(entry: {
  assessmentId: string;
  assessmentTitle: string;
  email: string;
  fullName?: string;
}): Promise<{ count: number; autoWarned: boolean; status: ProctorStatus | null }> {
  const db = await getDb();
  const emailNorm = normalizeEmailAddress(entry.email || '') || entry.email;
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO tab_switch_events (assessment_id, email_norm, email, full_name, assessment_title, switch_count, first_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(assessment_id, email_norm) DO UPDATE SET
        switch_count = tab_switch_events.switch_count + 1,
        assessment_title = excluded.assessment_title,
        email = excluded.email,
        full_name = COALESCE(excluded.full_name, tab_switch_events.full_name),
        updated_at = excluded.updated_at`,
    [entry.assessmentId, emailNorm, entry.email, entry.fullName || null, entry.assessmentTitle, now, now]
  );
  const result = await db.execute('SELECT switch_count FROM tab_switch_events WHERE assessment_id = ? AND email_norm = ?', [
    entry.assessmentId,
    emailNorm,
  ]);
  const count = result[0] ? Number(result[0].switch_count) : 1;

  let status = await getProctorStatus(entry.assessmentId, entry.email);

  // Automatic warning every AUTO_WARN_EVERY switches. A respondent an
  // admin has already blocked is left alone — blocked outranks warned, and
  // overwriting it would quietly let them back into the quiz.
  const autoWarned = count > 0 && count % AUTO_WARN_EVERY === 0 && status?.status !== 'blocked';
  if (autoWarned) {
    status = await issueProctorAction({
      assessmentId: entry.assessmentId,
      email: entry.email,
      action: 'warn',
      message: `Automatic warning: you have switched away from the assessment ${count} times. Stay on this screen — continued switching may end your attempt.`,
      issuedBy: 'system',
    });
  }

  return { count, autoWarned, status };
}

/** Returns every not-yet-cleared tab-switch event, pruning long-abandoned rows first. */
export async function listTabSwitchEvents(): Promise<TabSwitchEvent[]> {
  const db = await getDb();
  const cutoff = new Date(Date.now() - TAB_EVENT_ABANDONED_MS).toISOString();
  await db.execute('DELETE FROM tab_switch_events WHERE updated_at < ?', [cutoff]);
  const events = (await db.execute('SELECT * FROM tab_switch_events ORDER BY updated_at DESC')).map(rowToTabSwitchEvent);

  // Join each alert to its proctoring state so the dashboard can show, on
  // the alert itself, whether this respondent has already been warned or
  // blocked — without the admin having to open anything.
  const statuses = await db.execute('SELECT * FROM proctor_actions');
  const byKey = new Map<string, Row>();
  for (const row of statuses) byKey.set(`${row.assessment_id}::${row.email_norm}`, row);
  return events.map((e) => {
    const key = `${e.assessmentId}::${normalizeEmailAddress(e.email || '') || e.email}`;
    const row = byKey.get(key);
    if (!row) return { ...e, status: 'ok' as const, warnings: 0 };
    return { ...e, status: normalizeStatusName(row.status), warnings: Number(row.warnings) || 0 };
  });
}

/** Clears a respondent's live tab-switch row (called once they submit — the final count travels with their ResponseRecord instead). */
export async function clearTabSwitchEvent(assessmentId: string, email: string) {
  const db = await getDb();
  const emailNorm = normalizeEmailAddress(email || '') || email;
  await db.execute('DELETE FROM tab_switch_events WHERE assessment_id = ? AND email_norm = ?', [assessmentId, emailNorm]);
}

// --- Proctor actions (admin warns or blocks a respondent mid-quiz) ------
//
// One row per (assessment, respondent). An admin clicking Warn or Block on
// a live alert writes here; the participant's app polls it every few
// seconds while the quiz is open and reacts: a warning interrupts them
// with a dismissible notice, a block ends the attempt immediately.
//
// Rows are cleared when the respondent submits (alongside their
// tab-switch row) so a later attempt on a different assessment, or a
// re-opened one, starts clean.

function normalizeStatusName(raw: any): ProctorStatusName {
  return raw === 'blocked' ? 'blocked' : raw === 'warned' ? 'warned' : 'ok';
}

function rowToProctorStatus(row: Row): ProctorStatus {
  return {
    assessmentId: row.assessment_id,
    email: row.email,
    status: normalizeStatusName(row.status),
    warnings: Number(row.warnings) || 0,
    message: row.message || undefined,
    warningSeq: Number(row.warning_seq) || 0,
    issuedBy: row.issued_by || undefined,
    updatedAt: row.updated_at,
  };
}

/** Reads one respondent's current proctoring state, or null if no admin has ever acted on them. */
export async function getProctorStatus(assessmentId: string, email: string): Promise<ProctorStatus | null> {
  const db = await getDb();
  const emailNorm = normalizeEmailAddress(email || '') || email;
  const result = await db.execute('SELECT * FROM proctor_actions WHERE assessment_id = ? AND email_norm = ?', [
    assessmentId,
    emailNorm,
  ]);
  return result.length > 0 ? rowToProctorStatus(result[0]) : null;
}

/**
 * Applies a warn / block / clear decision to one respondent, returning
 * their resulting state. Warnings accumulate (and bump warning_seq so the
 * participant's app can tell a new warning from the one it already showed);
 * a block supersedes them; clearing resets the respondent to OK while
 * keeping the warning tally for the admin's reference.
 */
export async function issueProctorAction(entry: {
  assessmentId: string;
  email: string;
  action: 'warn' | 'block' | 'clear';
  message?: string;
  issuedBy?: string;
}): Promise<ProctorStatus> {
  const db = await getDb();
  const emailNorm = normalizeEmailAddress(entry.email || '') || entry.email;
  const now = new Date().toISOString();
  const current = await getProctorStatus(entry.assessmentId, entry.email);

  const warnings = entry.action === 'warn' ? (current?.warnings ?? 0) + 1 : current?.warnings ?? 0;
  // Only a warning needs to interrupt the participant again, so only a
  // warning advances the sequence the participant's app watches.
  const warningSeq = entry.action === 'warn' ? (current?.warningSeq ?? 0) + 1 : current?.warningSeq ?? 0;
  const status: ProctorStatusName = entry.action === 'block' ? 'blocked' : entry.action === 'warn' ? 'warned' : 'ok';
  const message = entry.action === 'clear' ? null : entry.message?.trim() || defaultProctorMessage(entry.action, warnings);

  await db.execute(
    `INSERT INTO proctor_actions
        (assessment_id, email_norm, email, status, warnings, message, warning_seq, issued_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(assessment_id, email_norm) DO UPDATE SET
        email = excluded.email,
        status = excluded.status,
        warnings = excluded.warnings,
        message = excluded.message,
        warning_seq = excluded.warning_seq,
        issued_by = excluded.issued_by,
        updated_at = excluded.updated_at`,
    [entry.assessmentId, emailNorm, entry.email, status, warnings, message, warningSeq, entry.issuedBy || null, now]
  );

  return (
    (await getProctorStatus(entry.assessmentId, entry.email)) ?? {
      assessmentId: entry.assessmentId,
      email: entry.email,
      status,
      warnings,
      message: message || undefined,
      warningSeq,
      issuedBy: entry.issuedBy,
      updatedAt: now,
    }
  );
}

function defaultProctorMessage(action: 'warn' | 'block', warnings: number): string {
  if (action === 'block') {
    return 'Your facilitator has ended this attempt because of activity detected during the assessment. Please speak with them.';
  }
  return warnings > 1
    ? `Warning ${warnings}: your facilitator has noticed you leaving the assessment screen. Please stay on this page.`
    : 'Your facilitator has noticed you leaving the assessment screen. Please stay on this page for the rest of the assessment.';
}

/** Clears a respondent's proctoring row (on submit, or when an admin dismisses the alert entirely). */
export async function clearProctorStatus(assessmentId: string, email: string) {
  const db = await getDb();
  const emailNorm = normalizeEmailAddress(email || '') || email;
  await db.execute('DELETE FROM proctor_actions WHERE assessment_id = ? AND email_norm = ?', [assessmentId, emailNorm]);
}
