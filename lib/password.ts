import crypto from 'crypto';

/** Salted scrypt password hashing (`scrypt$N$salt$hash`). Server-side only. */

const SCRYPT_N = 16384;

export function isHashed(stored: string): boolean {
  return typeof stored === 'string' && stored.startsWith('scrypt$');
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64, { N: SCRYPT_N, r: 8, p: 1 }).toString('hex');
  return `scrypt$${SCRYPT_N}$${salt}$${hash}`;
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!isHashed(stored)) return safeEqual(password, stored ?? ''); // legacy plain text, upgraded on next read
  const [, n, salt, hash] = stored.split('$');
  if (!salt || !hash) return false;
  try {
    const candidate = crypto.scryptSync(password, salt, 64, { N: Number(n) || SCRYPT_N, r: 8, p: 1 }).toString('hex');
    return safeEqual(candidate, hash);
  } catch {
    return false;
  }
}
