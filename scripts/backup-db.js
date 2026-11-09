const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'iquizify.db');
const LEGACY_DB_FILES = [path.join(DATA_DIR, 'assessify.db'), path.join(DATA_DIR, 'assessora.db')]; // pre-rebrand filenames
const BACKUP_DIR = path.join(process.cwd(), 'backups');
const KEEP_LAST = parseInt(process.env.BACKUP_KEEP || '30', 10);

/**
 * Makes a consistent snapshot of the live database using SQLite's own
 * `VACUUM INTO` (safe to run while the server is up and being written to,
 * unlike a plain file copy — it's a single atomic statement) and deletes
 * old snapshots beyond KEEP_LAST.
 */
async function backupOnce() {
  // Once TURSO_DATABASE_URL is set, the live data lives on Turso's server,
  // not in a local file — VACUUM INTO against a local path can't reach it.
  // Turso has its own backup/point-in-time-restore and database branching;
  // see https://docs.turso.tech/features/backups for the equivalent of
  // what this script used to do locally.
  if (process.env.TURSO_DATABASE_URL) {
    console.log(
      '[backup] TURSO_DATABASE_URL is set — data lives on Turso, not a local file. ' +
        'Use Turso\'s own backups/branching instead: https://docs.turso.tech/features/backups'
    );
    return null;
  }

  // Same app, renamed from Assessora to iQuizify — if the server process
  // hasn't run since the rename, the live file may still be under the old
  // name. Back that up rather than reporting "nothing to back up".
  const sourceFile = fs.existsSync(DB_FILE) ? DB_FILE : LEGACY_DB_FILES.find((f) => fs.existsSync(f)) || null;
  if (!sourceFile) {
    console.log('[backup] No database file yet — nothing to back up.');
    return null;
  }
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(BACKUP_DIR, `iquizify-${stamp}.db`);

  const db = new DatabaseSync(sourceFile, { readOnly: true });
  try {
    db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }

  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => (f.startsWith('iquizify-') || f.startsWith('assessify-') || f.startsWith('assessora-')) && f.endsWith('.db'))
    .sort();
  const excess = files.length - KEEP_LAST;
  for (let i = 0; i < excess; i++) fs.unlinkSync(path.join(BACKUP_DIR, files[i]));

  console.log(`[backup] Saved ${dest}`);
  return dest;
}

if (require.main === module) {
  backupOnce().catch((err) => {
    console.error('[backup] Failed:', err);
    process.exit(1);
  });
}

module.exports = { backupOnce };
