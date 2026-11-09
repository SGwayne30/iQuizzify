import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { fetchGoogleFormAsTemplate } from '@/lib/google-forms-import';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  if (!url) {
    return NextResponse.json({ ok: false, error: 'Please paste a Google Forms link.' }, { status: 400 });
  }
  try {
    const template = await fetchGoogleFormAsTemplate(url);
    return NextResponse.json({ ok: true, template });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not import that form.';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
