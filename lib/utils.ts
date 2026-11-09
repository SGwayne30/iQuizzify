import type { QuestionType } from './types';

export const ARCHIVE_RETENTION_DAYS = 30;

// --- Registration email allowlist --------------------------------------
//
// Registration accepts a Gmail address, any Philippine government
// ("gov.ph") work email, or a school address on educ.ph / education.ph.
// Add more domains here as needed — each entry matches that exact domain
// and any of its subdomains, so 'gov.ph' covers 'deped.gov.ph',
// 'region4a.deped.gov.ph', 'dfa.gov.ph', etc., and 'educ.ph' covers
// 'school.educ.ph' as well.
export const ALLOWED_EMAIL_DOMAINS = ['gmail.com', 'gov.ph', 'educ.ph', 'education.ph', 'edu.ph'];

const BASIC_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True if `email` is well-formed AND its domain is gmail.com, gov.ph, or a subdomain of one of those. */
export function isAllowedRegistrationEmail(email: string): boolean {
  const trimmed = email.trim().toLowerCase();
  if (!BASIC_EMAIL_PATTERN.test(trimmed)) return false;
  const domain = trimmed.slice(trimmed.lastIndexOf('@') + 1);
  return ALLOWED_EMAIL_DOMAINS.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));
}

export function uid(prefix: string) {
  return prefix + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

export function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let s = '';
  for (let i = 0; i < 3; i++) s += chars[Math.floor(Math.random() * chars.length)];
  const n = Math.floor(1000 + Math.random() * 9000);
  return s + '-' + n;
}

export function fmtDate(iso: string) {
  const d = new Date(iso);
  return (
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  );
}

export function archiveDaysRemaining(archivedAt: string | undefined, createdAt: string): number {
  const start = new Date(archivedAt || createdAt).getTime();
  if (!Number.isFinite(start)) return ARCHIVE_RETENTION_DAYS;
  const elapsed = Math.floor((Date.now() - start) / 86400000);
  return Math.max(0, ARCHIVE_RETENTION_DAYS - elapsed);
}

export const LIKERT_PRESETS: Record<number, string[]> = {
  3: ['Disagree', 'Neutral', 'Agree'],
  5: ['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'],
  7: [
    'Strongly Disagree',
    'Disagree',
    'Somewhat Disagree',
    'Neutral',
    'Somewhat Agree',
    'Agree',
    'Strongly Agree',
  ],
};

export function levelForPct(pct: number): { level: string; color: string } {
  if (pct >= 91) return { level: 'Expert', color: 'var(--success)' };
  if (pct >= 71) return { level: 'Proficient', color: 'var(--accent)' };
  if (pct >= 41) return { level: 'Competent', color: 'var(--primary)' };
  return { level: 'Novice', color: 'var(--danger)' };
}

/** Exact-match scoring for checkbox questions: every correct option picked, nothing extra. */
export function checkboxIsCorrect(selected: number[], correctIndexes: number[] | undefined): boolean {
  if (!correctIndexes || correctIndexes.length === 0) return false;
  const a = [...new Set(selected)].sort((x, y) => x - y);
  const b = [...new Set(correctIndexes)].sort((x, y) => x - y);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Human-readable label for each question type, used in the builder's type picker and everywhere a type is displayed. */
export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  mcq: 'Multiple Choice',
  yesNo: 'Yes / No',
  checkbox: 'Checkboxes',
  dropdown: 'Dropdown',
  shortAnswer: 'Short Answer',
  paragraph: 'Paragraph',
  fileUpload: 'File Upload',
  likert: 'Likert Scale',
  linearScale: 'Linear Scale',
  rating: 'Rating',
  mcqGrid: 'Multiple Choice Grid',
  checkboxGrid: 'Checkbox Grid',
  date: 'Date',
  time: 'Time',
};

/** Types that are always ungraded / opinion-collecting — never contribute to score. */
export const UNGRADED_TYPES: QuestionType[] = [
  'paragraph',
  'shortAnswer',
  'fileUpload',
  'likert',
  'linearScale',
  'rating',
  'mcqGrid',
  'checkboxGrid',
  'date',
  'time',
];

/** Types whose options are shared choice labels (as opposed to grid columns, or no options at all). */
export const CHOICE_TYPES: QuestionType[] = ['mcq', 'yesNo', 'checkbox', 'dropdown'];

/** Types answered on the quiz screen with an explicit "Submit answer" step rather than locking in on first tap. */
export const EXPLICIT_SUBMIT_TYPES: QuestionType[] = [
  'checkbox',
  'paragraph',
  'shortAnswer',
  'fileUpload',
  'date',
  'time',
  'mcqGrid',
  'checkboxGrid',
];

export const RATING_PRESETS = [3, 5, 10];
export const LINEAR_SCALE_PRESETS = [5, 10];