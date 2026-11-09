import { NextResponse } from 'next/server';
import { requireAdmin, passwordProblem, sessionCookieHeader } from '@/lib/auth';
import { hashPassword } from '@/lib/password';
import { getAdminAccountsMigrated, saveAdminAccounts } from '@/lib/server-db';
import { rateLimit, rateLimitResponse, getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const publicView = (a: { id: string; username: string; role: 'super' | 'admin' }) => ({
  id: a.id,
  username: a.username,
  role: a.role,
});

function cleanUsername(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().slice(0, 60) : '';
}

/** Create an account (super admin only). Body: { username, password } */
export async function POST(req: Request) {
  const auth = await requireAdmin(req, { superOnly: true });
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => null);
  const username = cleanUsername(body?.username);
  const problem = passwordProblem(body?.password);
  if (!username) return NextResponse.json({ ok: false, error: 'Username is required.' }, { status: 400 });
  if (problem) return NextResponse.json({ ok: false, error: problem }, { status: 400 });
  const accounts = await getAdminAccountsMigrated();
  if (accounts.some((a) => a.username.toLowerCase() === username.toLowerCase())) {
    return NextResponse.json({ ok: false, error: 'That username is already taken.' }, { status: 409 });
  }
  const account = {
    id: `admin_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    username,
    password: hashPassword(body.password),
    role: 'admin' as const,
  };
  await saveAdminAccounts([...accounts, account]);
  return NextResponse.json({ ok: true, account: publicView(account) });
}

/**
 * Change a username and/or password. A super admin may edit anyone; everyone else only themselves.
 * Body: { id, username?, password? }
 */
export async function PATCH(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const limited = rateLimit(`accounts:${getClientIp(req)}`, 20, 5 * 60 * 1000);
  if (!limited.allowed) return rateLimitResponse(limited);

  const body = await req.json().catch(() => null);
  const id = typeof body?.id === 'string' ? body.id : '';
  if (auth.role !== 'super' && auth.id !== id) {
    return NextResponse.json({ ok: false, error: 'You can only edit your own account.' }, { status: 403 });
  }
  const accounts = await getAdminAccountsMigrated();
  const target = accounts.find((a) => a.id === id);
  if (!target) return NextResponse.json({ ok: false, error: 'Account not found.' }, { status: 404 });

  let next = { ...target };
  if (body?.username !== undefined) {
    const username = cleanUsername(body.username);
    if (!username) return NextResponse.json({ ok: false, error: 'Username is required.' }, { status: 400 });
    if (accounts.some((a) => a.id !== id && a.username.toLowerCase() === username.toLowerCase())) {
      return NextResponse.json({ ok: false, error: 'That username is already taken.' }, { status: 409 });
    }
    next.username = username;
  }
  if (body?.password !== undefined && body.password !== '') {
    const problem = passwordProblem(body.password);
    if (problem) return NextResponse.json({ ok: false, error: problem }, { status: 400 });
    next.password = hashPassword(body.password);
  }
  await saveAdminAccounts(accounts.map((a) => (a.id === id ? next : a)));

  const res = NextResponse.json({ ok: true, account: publicView(next) });
  // Changing your own password ends your other sessions; keep this one signed in.
  if (auth.id === id) res.headers.append('Set-Cookie', await sessionCookieHeader(req, next));
  return res;
}

/** Remove an account (super admin only; not yourself, never the last super admin). */
export async function DELETE(req: Request) {
  const auth = await requireAdmin(req, { superOnly: true });
  if (auth instanceof NextResponse) return auth;
  const id = new URL(req.url).searchParams.get('id') || '';
  if (id === auth.id) return NextResponse.json({ ok: false, error: 'You cannot remove your own account.' }, { status: 400 });
  const accounts = await getAdminAccountsMigrated();
  const target = accounts.find((a) => a.id === id);
  if (!target) return NextResponse.json({ ok: false, error: 'Account not found.' }, { status: 404 });
  if (target.role === 'super' && accounts.filter((a) => a.role === 'super').length <= 1) {
    return NextResponse.json({ ok: false, error: 'There must be at least one super admin.' }, { status: 400 });
  }
  await saveAdminAccounts(accounts.filter((a) => a.id !== id));
  return NextResponse.json({ ok: true });
}
