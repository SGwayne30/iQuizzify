import { NextResponse } from 'next/server';
import { findResponse } from '@/lib/server-db';
import { rateLimit, rateLimitResponse, getClientIp } from '@/lib/rate-limit';
import { isAllowedRegistrationEmail } from '@/lib/utils';

// A participant may retry a lookup, but this also prevents mass probing for
// addresses that have already responded.
const LIMIT = 20;
const WINDOW_MS = 60 * 1000; // 1 minute

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const ip = getClientIp(req);
  const result = rateLimit(`check:${ip}`, LIMIT, WINDOW_MS);
  if (!result.allowed) {
    return rateLimitResponse(result);
  }

  const { searchParams } = new URL(req.url);
  const assessmentId = searchParams.get('assessmentId') || '';
  const email = searchParams.get('email') || '';

  if (!assessmentId || !email || !isAllowedRegistrationEmail(email)) {
    return NextResponse.json({ record: null });
  }

  const existing = await findResponse(assessmentId, email);
  return NextResponse.json({ record: existing });
}
