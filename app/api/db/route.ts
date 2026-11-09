import { NextResponse } from 'next/server';
import { readServerDB, readPublicDB, writeServerDB } from '@/lib/server-db';
import { getSession, requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Signed-in admins get everything (never including password hashes). Anyone else — i.e. a
 * student's browser — gets only the registration options and the active assessments.
 */
export async function GET(req: Request) {
  const session = await getSession(req);
  const db = session ? await readServerDB() : await readPublicDB();
  return NextResponse.json({ ...db, viewer: session ? 'admin' : 'public' });
}

/** Admin only: saves assessments, field options and the response list. */
export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const body = await req.json();
  // writeServerDB runs inside a single SQLite transaction (see lib/server-db.ts),
  // so this is already atomic without needing an app-level lock.
  await writeServerDB(body);
  return NextResponse.json({ ok: true });
}
