import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { getAdminAccountsMigrated, getAuthSecret } from './server-db';
import type { AdminAccount } from './types';
import { safeEqual } from './password';

export { hashPassword, verifyPassword, isHashed } from './password';

/**
 * Admin authentication.
 *
 * - Passwords are stored as salted scrypt hashes (`scrypt$N$salt$hash`).
 *   Legacy plain-text passwords are upgraded automatically by getAdminAccountsMigrated().
 * - A successful login sets a signed, HttpOnly session cookie (HMAC-SHA256). The signing secret
 *   comes from AUTH_SECRET, or is generated once and kept in the database so every server
 *   instance shares it.
 * - A session stops working as soon as the account's password changes or the account is removed.
 */

export const SESSION_COOKIE = 'iq_admin';
const SESSION_MS = 12 * 60 * 60 * 1000; // 12 hours
export const DEFAULT_PASSWORD = 'admin123';
export const MIN_PASSWORD_LENGTH = 8;

export interface Session {
  id: string;
  username: string;
  role: 'super' | 'admin';
}

/** Why a new password is not acceptable, or null if it is fine. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 200) return 'Password is too long.';
  if (password === DEFAULT_PASSWORD) return 'Please choose a password other than the default.';
  return null;
}

// --- Session cookie --------------------------------------------------------

function b64(s: string): string {
  return Buffer.from(s).toString('base64url');
}

function fingerprint(account: Pick<AdminAccount, 'password'>): string {
  return crypto.createHash('sha256').update(account.password ?? '').digest('hex').slice(0, 16);
}

async function sign(payload: string): Promise<string> {
  const secret = await getAuthSecret();
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function isSecureRequest(req: Request): boolean {
  return new URL(req.url).protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https';
}

export async function sessionCookieHeader(req: Request, account: AdminAccount): Promise<string> {
  const payload = b64(
    JSON.stringify({ id: account.id, pv: fingerprint(account), exp: Date.now() + SESSION_MS })
  );
  const token = `${payload}.${await sign(payload)}`;
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${isSecureRequest(req) ? '; Secure' : ''}`;
}

export function clearCookieHeader(req: Request): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isSecureRequest(req) ? '; Secure' : ''}`;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

/** The signed-in admin for this request, or null. Re-checks the account on every call. */
export async function getSession(req: Request): Promise<Session | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  if (!safeEqual(sig, await sign(payload))) return null;
  let data: { id?: string; pv?: string; exp?: number };
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!data.id || typeof data.exp !== 'number' || data.exp < Date.now()) return null;
  const account = (await getAdminAccountsMigrated()).find((a) => a.id === data.id);
  if (!account || fingerprint(account) !== data.pv) return null;
  return { id: account.id, username: account.username, role: account.role };
}

/**
 * Guard for admin-only routes. Returns the session, or a ready-made 401/403 response:
 *
 *   const auth = await requireAdmin(req);
 *   if (auth instanceof NextResponse) return auth;
 */
export async function requireAdmin(req: Request, opts: { superOnly?: boolean } = {}): Promise<Session | NextResponse> {
  // Cookies are SameSite=Lax already; this also rejects cross-site state-changing requests outright.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.get('origin');
    const host = req.headers.get('host');
    if (origin && host) {
      let originHost = '';
      try {
        originHost = new URL(origin).host;
      } catch {
        // fall through to the mismatch below
      }
      if (originHost !== host) {
        return NextResponse.json({ ok: false, error: 'Cross-site request blocked.' }, { status: 403 });
      }
    }
  }
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  }
  if (opts.superOnly && session.role !== 'super') {
    return NextResponse.json({ ok: false, error: 'Only a super admin can do that.' }, { status: 403 });
  }
  return session;
}
