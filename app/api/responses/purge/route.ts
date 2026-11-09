import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { purgeArchivedResponses } from '@/lib/server-db';

export const dynamic = 'force-dynamic';

const MAX_IDS = 5000;

/** Permanently deletes archived responses (only those whose assessment was exported). Body: { ids: string[] } */
export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => null);
  const ids: unknown = body?.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS || !ids.every((id) => typeof id === 'string')) {
    return NextResponse.json({ error: 'ids must be a non-empty list of response ids.' }, { status: 400 });
  }
  const result = await purgeArchivedResponses(ids as string[]);
  return NextResponse.json({ ok: true, ...result });
}
