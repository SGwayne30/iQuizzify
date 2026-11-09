import { NextResponse } from 'next/server';
import { getAdminAccountsMigrated } from '@/lib/server-db';
import { verifyPassword } from '@/lib/password';
import { sessionCookieHeader, DEFAULT_PASSWORD } from '@/lib/auth';
import { rateLimit, rateLimitResponse, getClientIp } from '@/lib/rate-limit';

const LIMIT = 5;
const WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const result = rateLimit(`login:${ip}`, LIMIT, WINDOW_MS);
  if (!result.allowed) {
    return rateLimitResponse(result);
  }

  const body = await req.json().catch(() => null);
  const username = (typeof body?.username === 'string' ? body.username : '').trim().toLowerCase();
  const password = typeof body?.password === 'string' ? body.password : '';

  // Deliberately generic error and identical response shape whether the
  // username exists or not, so this endpoint can't be used to enumerate
  // valid usernames.
  const accounts = await getAdminAccountsMigrated();
  const account = accounts.find((a) => a.username.trim().toLowerCase() === username);
  const valid = account ? verifyPassword(password, account.password ?? '') : false;

  if (!account || !valid) {
    return NextResponse.json(
      { ok: false, error: 'Invalid username or password.', remaining: result.remaining },
      { status: 401 }
    );
  }

  const res = NextResponse.json({
    ok: true,
    account: { id: account.id, username: account.username, role: account.role },
    mustChangePassword: verifyPassword(DEFAULT_PASSWORD, account.password ?? ''),
  });
  res.headers.append('Set-Cookie', await sessionCookieHeader(req, account));
  return res;
}
