import { NextResponse } from 'next/server';
import { insertResponseIfNew, normalizeEmailAddress, getAssessmentById } from '@/lib/server-db';
import { regradeAnswers } from '@/lib/quiz-utils';
import { rateLimit, rateLimitResponse, getClientIp } from '@/lib/rate-limit';
import { isAllowedRegistrationEmail } from '@/lib/utils';
import type { ResponseRecord } from '@/lib/types';

const LIMIT = 10;
const WINDOW_MS = 60 * 1000; // 1 minute

export const dynamic = 'force-dynamic';

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const result = rateLimit(`submit:${ip}`, LIMIT, WINDOW_MS);
  if (!result.allowed) {
    return rateLimitResponse(result);
  }

  const body = await req.json().catch(() => null);
  const { assessmentId, email, demographics, answers, totalScore, maxScore, correctCount, totalQuestions, tabSwitchCount } =
    body || {};

  if (!isAllowedRegistrationEmail(email || '')) {
    return NextResponse.json(
      { error: 'A valid Gmail or government (.gov.ph) email address is required.' },
      { status: 400 }
    );
  }
  const normEmail = normalizeEmailAddress(email || '');
  if (!assessmentId) {
    return NextResponse.json({ error: 'assessmentId is required.' }, { status: 400 });
  }

  // Never trust a score computed in the browser: re-grade the answers against
  // the stored answer key so totals can't be tampered with.
  const assessment = await getAssessmentById(assessmentId);
  if (!assessment || assessment.status !== 'active') {
    return NextResponse.json({ error: 'This assessment is not available.' }, { status: 404 });
  }
  const safeAnswers = Array.isArray(answers) ? answers : [];
  const graded = regradeAnswers(assessment, safeAnswers);

  const record: ResponseRecord = {
    id: uid('resp'),
    assessmentId,
    demographics: { ...demographics, email: normEmail },
    answers: graded.answers,
    totalScore: graded.totalScore,
    maxScore: graded.maxScore,
    correctCount: graded.correctCount,
    totalQuestions: assessment.questions.length,
    submittedAt: new Date().toISOString(),
    tabSwitchCount: typeof tabSwitchCount === 'number' && tabSwitchCount > 0 ? Math.floor(tabSwitchCount) : 0,
  };

  // The database's own UNIQUE(assessment_id, email_norm) constraint is what
  // actually guarantees one response per Gmail — this insert either
  // succeeds or tells us about the row that already won the race, with no
  // window for two concurrent requests to both slip through.
  const outcome = await insertResponseIfNew(record);

  if (!outcome.inserted) {
    return NextResponse.json({ duplicate: true, record: outcome.record }, { status: 409 });
  }
  return NextResponse.json({ duplicate: false, record: outcome.record }, { status: 201 });
}
