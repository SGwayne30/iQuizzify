import { NextResponse } from 'next/server';
import { getProctorStatus, issueProctorAction, clearProctorStatus } from '@/lib/server-db';
import { requireAdmin } from '@/lib/auth';
import { rateLimit, rateLimitResponse, getClientIp } from '@/lib/rate-limit';

// The participant polls this on a timer while mid-quiz, so the ceiling has
// to comfortably clear one request every few seconds without letting a
// runaway loop hammer the database.
const LIMIT = 90;
const WINDOW_MS = 60 * 1000; // 1 minute

export const dynamic = 'force-dynamic';

/**
 * Participant app: "has my facilitator warned or blocked me?" — polled
 * every few seconds while the quiz screen is open.
 */
export async function GET(req: Request) {
  const ip = getClientIp(req);
  const result = rateLimit(`proctor:${ip}`, LIMIT, WINDOW_MS);
  if (!result.allowed) {
    return rateLimitResponse(result);
  }

  const { searchParams } = new URL(req.url);
  const assessmentId = searchParams.get('assessmentId') || '';
  const email = searchParams.get('email') || '';
  if (!assessmentId || !email.trim()) {
    return NextResponse.json({ status: null });
  }
  const status = await getProctorStatus(assessmentId, email);
  return NextResponse.json({ status });
}

/** Admin dashboard: warn, block, or clear one respondent from a live alert. */
export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => null);
  const assessmentId = typeof body?.assessmentId === 'string' ? body.assessmentId.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const message = typeof body?.message === 'string' ? body.message : '';
  const issuedBy = typeof body?.issuedBy === 'string' ? body.issuedBy.trim() : '';
  const action = body?.action;

  if (!assessmentId || !email) {
    return NextResponse.json({ ok: false, error: 'assessmentId and email are required' }, { status: 400 });
  }
  if (action !== 'warn' && action !== 'block' && action !== 'clear') {
    return NextResponse.json({ ok: false, error: "action must be 'warn', 'block' or 'clear'" }, { status: 400 });
  }

  const status = await issueProctorAction({
    assessmentId,
    email,
    action,
    message,
    issuedBy: issuedBy || undefined,
  });
  return NextResponse.json({ ok: true, status });
}

/** Removes a respondent's proctoring row entirely (admin dismissing an alert for good). */
export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const assessmentId = searchParams.get('assessmentId') || '';
  const email = searchParams.get('email') || '';
  if (!assessmentId || !email) {
    return NextResponse.json({ ok: false, error: 'assessmentId and email are required' }, { status: 400 });
  }
  await clearProctorStatus(assessmentId, email);
  return NextResponse.json({ ok: true });
}
