import { NextResponse } from 'next/server';
import { upsertPresence, clearPresence, listPresence } from '@/lib/server-db';
import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const entries = await listPresence();
  return NextResponse.json({ entries });
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const body = await req.json();
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const assessmentId = typeof body.assessmentId === 'string' ? body.assessmentId.trim() : '';
  const assessmentTitle = typeof body.assessmentTitle === 'string' ? body.assessmentTitle.trim() : '';
  const action = body.action === 'creating' ? 'creating' : 'editing';
  if (!username || !assessmentId) {
    return NextResponse.json({ ok: false, error: 'username and assessmentId are required' }, { status: 400 });
  }
  await upsertPresence({ username, assessmentId, assessmentTitle: assessmentTitle || 'Untitled', action });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { searchParams } = new URL(req.url);
  const username = searchParams.get('username') || '';
  if (!username) {
    return NextResponse.json({ ok: false, error: 'username is required' }, { status: 400 });
  }
  await clearPresence(username);
  return NextResponse.json({ ok: true });
}
