import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { archiveResponses } from '@/lib/server-db';

export const dynamic = 'force-dynamic';

const MAX_IDS = 5000;

/** Moves the given responses into the archive (recoverable). Body: { ids: string[], by?: string } */
export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => null);
  const ids: unknown = body?.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS || !ids.every((id) => typeof id === 'string')) {
    return NextResponse.json({ error: 'ids must be a non-empty list of response ids.' }, { status: 400 });
  }
  const by = typeof body?.by === 'string' && body.by.trim() ? body.by.trim().slice(0, 80) : undefined;
  const result = await archiveResponses(ids as string[], by);
  return NextResponse.json({ ok: true, ...result });
}
