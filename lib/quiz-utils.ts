import type { AnswerRecord, Assessment, Question } from './types';
import { checkboxIsCorrect } from './utils';

/** Question types whose choices can be shuffled without changing their meaning. */
const SHUFFLEABLE_OPTION_TYPES = ['mcq', 'checkbox', 'dropdown'];

export const PARTICIPATION_POINTS = 10;

export function showAnswersFor(a: Pick<Assessment, 'settings'> | null | undefined): boolean {
  return a?.settings?.showAnswers !== false;
}

export function timeLimitSecondsFor(a: Pick<Assessment, 'settings'> | null | undefined): number {
  const m = a?.settings?.timeLimitMinutes;
  return typeof m === 'number' && m > 0 ? Math.round(m * 60) : 0;
}

function shuffled<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Per-question permutation of answer choices: `perm[shuffledPosition] = originalIndex`.
 * Only recorded for questions whose options were actually shuffled.
 */
export type OptionPerms = Record<string, number[]>;

export interface QuizQueue {
  queue: Question[];
  /** Question ids in the order this student sees them. */
  order: string[];
  perms: OptionPerms;
}

function applyPerm(q: Question, perm: number[]): Question {
  const next: Question = { ...q, options: perm.map((i) => q.options[i]) };
  if (q.correctIndex >= 0) next.correctIndex = perm.indexOf(q.correctIndex);
  if (q.correctIndexes) next.correctIndexes = q.correctIndexes.map((c) => perm.indexOf(c)).filter((c) => c >= 0);
  return next;
}

/** Builds the question list one student will see, honouring the assessment's shuffle settings. */
export function buildQuizQueue(assessment: Assessment): QuizQueue {
  let questions = [...assessment.questions];
  if (assessment.settings?.shuffleQuestions) {
    // Shuffle inside each section so section headings keep their order.
    const groups = new Map<string, Question[]>();
    for (const q of questions) {
      const key = q.sectionId ?? '';
      groups.set(key, [...(groups.get(key) ?? []), q]);
    }
    questions = [...groups.values()].flatMap((g) => shuffled(g));
  }
  const perms: OptionPerms = {};
  if (assessment.settings?.shuffleOptions) {
    questions = questions.map((q) => {
      if (!SHUFFLEABLE_OPTION_TYPES.includes(q.type || 'mcq') || q.options.length < 2) return q;
      const perm = shuffled(q.options.map((_, i) => i));
      perms[q.id] = perm;
      return applyPerm(q, perm);
    });
  }
  return { queue: questions, order: questions.map((q) => q.id), perms };
}

/** Rebuilds the exact queue a student was shown (used when a saved attempt is resumed). */
export function restoreQuizQueue(assessment: Assessment, order?: string[], perms?: OptionPerms): Question[] {
  if (!order || order.length !== assessment.questions.length) return [...assessment.questions];
  const byId = new Map(assessment.questions.map((q) => [q.id, q]));
  const out: Question[] = [];
  for (const id of order) {
    const q = byId.get(id);
    if (!q) return [...assessment.questions];
    const perm = perms?.[id];
    out.push(perm && perm.length === q.options.length ? applyPerm(q, perm) : q);
  }
  return out;
}

/** Converts answers recorded against shuffled choices back to the assessment's original option indexes. */
export function answersToOriginalOrder(answers: AnswerRecord[], perms: OptionPerms): AnswerRecord[] {
  return answers.map((a) => {
    const perm = perms[a.questionId];
    if (!perm) return a;
    const next = { ...a };
    if (a.selectedIndex >= 0 && a.selectedIndex < perm.length) next.selectedIndex = perm[a.selectedIndex];
    if (a.selectedIndexes) next.selectedIndexes = a.selectedIndexes.map((i) => perm[i]).sort((x, y) => x - y);
    return next;
  });
}

/** mm:ss (or h:mm:ss) for the countdown. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

/**
 * Re-grades the objectively-gradable answers (mcq / yes-no / dropdown / checkbox with an answer key)
 * against the stored assessment, so a score can never be trusted from the browser. Everything else
 * keeps the participation points the client recorded. Returns the corrected answers and totals.
 */
export function regradeAnswers(assessment: Assessment, answers: AnswerRecord[]) {
  const byId = new Map(assessment.questions.map((q) => [q.id, q]));
  const graded: AnswerRecord[] = [];
  for (const a of answers) {
    const q = byId.get(a.questionId);
    if (!q) continue;
    const type = q.type || 'mcq';
    const points = typeof q.points === 'number' ? q.points : 10;
    if (['mcq', 'yesNo', 'dropdown'].includes(type) && q.correctIndex >= 0) {
      const ok = a.selectedIndex === q.correctIndex;
      graded.push({ ...a, correct: a.selectedIndex < 0 ? null : ok, pointsEarned: ok ? points : 0 });
    } else if (type === 'checkbox' && q.correctIndexes && q.correctIndexes.length > 0) {
      const ok = checkboxIsCorrect(a.selectedIndexes || [], q.correctIndexes);
      graded.push({ ...a, correct: (a.selectedIndexes || []).length === 0 ? null : ok, pointsEarned: ok ? points : 0 });
    } else {
      graded.push({ ...a, pointsEarned: Math.min(Math.max(a.pointsEarned || 0, 0), a.correct === null ? PARTICIPATION_POINTS : 0) });
    }
  }
  // Same formula the participant app uses, so client and server totals agree.
  const maxScore = assessment.questions.reduce(
    (sum, q) => sum + (q.correctIndex >= 0 && typeof q.points === 'number' ? q.points : PARTICIPATION_POINTS),
    0
  );
  return {
    answers: graded,
    totalScore: graded.reduce((s, a) => s + a.pointsEarned, 0),
    correctCount: graded.filter((a) => a.correct === true).length,
    maxScore,
  };
}
