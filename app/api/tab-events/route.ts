import { NextResponse } from 'next/server';
import { recordTabSwitch, listTabSwitchEvents, clearTabSwitchEvent } from '@/lib/server-db';
import { requireAdmin } from '@/lib/auth';
import { rateLimit, rateLimitResponse, getClientIp } from '@/lib/rate-limit';

const LIMIT = 60;
const WINDOW_MS = 60 * 1000; // 1 minute — generous, but stops a runaway loop from hammering the DB

export const dynamic = 'force-dynamic';

/** Admin dashboard polls this to see, live, who's switching tabs mid-assessment. */
export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const entries = await listTabSwitchEvents();
  return NextResponse.json({ entries });
}

/** Participant app calls this each time it detects the quiz tab/window losing visibility. */
export async function POST(req: Request) {
  const ip = getClientIp(req);
  const result = rateLimit(`tab-event:${ip}`, LIMIT, WINDOW_MS);
  if (!result.allowed) {
    return rateLimitResponse(result);
  }

  const body = await req.json().catch(() => null);
  const assessmentId = typeof body?.assessmentId === 'string' ? body.assessmentId.trim() : '';
  const assessmentTitle = typeof body?.assessmentTitle === 'string' ? body.assessmentTitle.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const fullName = typeof body?.fullName === 'string' ? body.fullName.trim() : '';
  if (!assessmentId || !email) {
    return NextResponse.json({ ok: false, error: 'assessmentId and email are required' }, { status: 400 });
  }
  const { count, autoWarned, status } = await recordTabSwitch({
    assessmentId,
    assessmentTitle: assessmentTitle || 'Untitled',
    email,
    fullName: fullName || undefined,
  });
  return NextResponse.json({ ok: true, count, autoWarned, status });
}

/** Clears the live row once a respondent submits (or an admin dismisses it). */
export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const assessmentId = searchParams.get('assessmentId') || '';
  const email = searchParams.get('email') || '';
  if (!assessmentId || !email) {
    return NextResponse.json({ ok: false, error: 'assessmentId and email are required' }, { status: 400 });
  }
  await clearTabSwitchEvent(assessmentId, email);
  return NextResponse.json({ ok: true });
}
