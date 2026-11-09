import { NextResponse } from 'next/server';
import { getSession, DEFAULT_PASSWORD } from '@/lib/auth';
import { getAdminAccountsMigrated } from '@/lib/server-db';
import { verifyPassword } from '@/lib/password';

export const dynamic = 'force-dynamic';

/** Who is signed in? Used by the dashboard to restore a session after a reload. */
export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  const account = (await getAdminAccountsMigrated()).find((a) => a.id === session.id);
  return NextResponse.json({
    ok: true,
    account: session,
    mustChangePassword: account ? verifyPassword(DEFAULT_PASSWORD, account.password ?? '') : false,
  });
}
