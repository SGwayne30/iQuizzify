import type { QuestionnaireTemplate } from './questionnaire-io';
import type { QuestionType } from './types';

// Google doesn't offer a public API for reading an arbitrary form's
// questions, but every "viewform" page embeds the full form structure
// (every page/section, question, and choice) in a big untyped JS array
// literal assigned to `FB_PUBLIC_LOAD_DATA_`. This is the same technique
// used by most open-source Google Forms tools (form-fillers, scrapers,
// etc.) — it's not an official/stable API, so parsing here is defensive:
// anything we can't confidently map falls back to a plain paragraph
// question with the original title, rather than being silently dropped
// or crashing the whole import.

// --- Known (reverse-engineered) item type codes --------------------------
const T_SHORT_ANSWER = 0;
const T_PARAGRAPH = 1;
const T_MULTIPLE_CHOICE = 2;
const T_DROPDOWN = 3;
const T_CHECKBOXES = 4;
const T_LINEAR_SCALE = 5;
const T_TITLE_AND_DESCRIPTION = 6; // section header, no page break
const T_GRID = 7; // multiple choice grid or checkbox grid
const T_PAGE_BREAK = 8; // new page — treated the same as a section header
const T_DATE = 9;
const T_TIME = 10;
const T_FILE_UPLOAD = 13;

function isArr(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Extracts option label text from an entry's option array, e.g. [["Yes"],["No"]] -> ["Yes","No"]. Blank/"Other" slots become "Other". */
function extractOptionLabels(rawOptions: unknown): string[] {
  if (!isArr(rawOptions)) return [];
  return rawOptions.map((opt, i) => {
    const text = isArr(opt) ? str(opt[0]) : '';
    if (text.trim()) return text;
    // Google represents the "Other:" choice as an option with no label text.
    return i === rawOptions.length - 1 ? 'Other' : `Option ${i + 1}`;
  });
}

interface ParsedItem {
  kind: 'section' | 'question';
  title: string;
  description: string;
  question?: {
    type: QuestionType;
    options: string[];
    rows?: string[];
    scaleMax?: number;
  };
}

function parseItem(item: unknown[]): ParsedItem | null {
  const title = str(item[1]).trim();
  const description = str(item[2]).trim();
  const typeCode = typeof item[3] === 'number' ? item[3] : -1;

  if (typeCode === T_TITLE_AND_DESCRIPTION || typeCode === T_PAGE_BREAK) {
    return { kind: 'section', title: title || 'Section', description };
  }
  if (!title) return null; // no question text to import at all — skip silently

  const data = isArr(item[4]) ? item[4] : [];
  const sub = isArr(data[0]) ? data[0] : [];

  try {
    switch (typeCode) {
      case T_SHORT_ANSWER:
        return { kind: 'question', title, description, question: { type: 'shortAnswer', options: [] } };
      case T_PARAGRAPH:
        return { kind: 'question', title, description, question: { type: 'paragraph', options: [] } };
      case T_MULTIPLE_CHOICE: {
        const options = extractOptionLabels(sub[1]);
        return options.length >= 2
          ? { kind: 'question', title, description, question: { type: 'mcq', options } }
          : fallback(title, description);
      }
      case T_DROPDOWN: {
        const options = extractOptionLabels(sub[1]);
        return options.length >= 2
          ? { kind: 'question', title, description, question: { type: 'dropdown', options } }
          : fallback(title, description);
      }
      case T_CHECKBOXES: {
        const options = extractOptionLabels(sub[1]);
        return options.length >= 2
          ? { kind: 'question', title, description, question: { type: 'checkbox', options } }
          : fallback(title, description);
      }
      case T_LINEAR_SCALE: {
        const points = isArr(sub[1]) ? sub[1].length : 0;
        const labels = isArr(sub[3]) ? sub[3] : [];
        const minLabel = str(labels[0]);
        const maxLabel = str(labels[1]);
        return {
          kind: 'question',
          title,
          description,
          question: { type: 'linearScale', options: [minLabel, maxLabel], scaleMax: points >= 2 ? points : 5 },
        };
      }
      case T_GRID: {
        const rows = data.map((row) => (isArr(row) ? str(row[3]) : '')).filter((r) => r.trim());
        const cols = extractOptionLabels(sub[1]);
        // The multi-select (checkbox grid) vs single-select (radio grid)
        // distinction lives deep in a nested flag whose index isn't
        // consistently documented — default to the far more common radio
        // grid rather than guess wrong and silently mis-grade responses.
        if (rows.length >= 1 && cols.length >= 2) {
          return { kind: 'question', title, description, question: { type: 'mcqGrid', options: cols, rows } };
        }
        return fallback(title, description);
      }
      case T_DATE:
        return { kind: 'question', title, description, question: { type: 'date', options: [] } };
      case T_TIME:
        return { kind: 'question', title, description, question: { type: 'time', options: [] } };
      case T_FILE_UPLOAD:
        return { kind: 'question', title, description, question: { type: 'fileUpload', options: [] } };
      default:
        return fallback(title, description);
    }
  } catch {
    return fallback(title, description);
  }
}

/** Anything we can't confidently map still comes through — as a plain paragraph question — instead of being dropped. */
function fallback(title: string, description: string): ParsedItem {
  return { kind: 'question', title, description, question: { type: 'paragraph', options: [] } };
}

function extractFormId(url: URL): string | null {
  const m = url.pathname.match(/\/forms\/d\/e\/([^/]+)/) || url.pathname.match(/\/forms\/d\/([^/]+)/);
  return m ? m[1] : null;
}

/** Normalizes any Google Forms link a person might paste (edit link, share link, short link) to its public /viewform URL. */
function normalizeFormUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("That doesn't look like a valid URL.");
  }
  const host = url.hostname.replace(/^www\./, '');
  if (host !== 'docs.google.com' && host !== 'forms.gle') {
    throw new Error('Please paste a Google Forms link (docs.google.com/forms/... or forms.gle/...).');
  }
  if (host === 'forms.gle') return url; // fetch() below follows the redirect to docs.google.com
  const formId = extractFormId(url);
  if (!formId) throw new Error("Couldn't find a form in that link.");
  return new URL(`https://docs.google.com/forms/d/e/${formId}/viewform`);
}

/** Fetches a public Google Form and converts it into this app's importable questionnaire shape. */
export async function fetchGoogleFormAsTemplate(rawUrl: string): Promise<QuestionnaireTemplate> {
  const url = normalizeFormUrl(rawUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let html: string;
  try {
    const res = await fetch(url.toString(), {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'text/html',
      },
    });
    if (!res.ok) {
      throw new Error(
        res.status === 404
          ? "That form couldn't be found — check the link."
          : `Google returned an error (${res.status}) fetching that form.`
      );
    }
    html = await res.text();
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Timed out reaching Google Forms — please try again.');
    }
    throw err instanceof Error ? err : new Error('Could not fetch that form.');
  } finally {
    clearTimeout(timeout);
  }

  if (/accounts\.google\.com\/ServiceLogin/.test(html) || /<title>Sign in/i.test(html)) {
    throw new Error(
      'That form requires signing in to view — only forms shared with "Anyone with the link" can be imported.'
    );
  }

  // Find the <script> tag containing the data, then take everything from
  // its first `[` to its *last* `;` — safer than a bracket-matching regex,
  // since the array itself is riddled with `],` sequences that would trip
  // up a naive non-greedy match. There can be more than one script tag
  // that *mentions* the variable name (e.g. an early forward declaration),
  // so try every candidate and keep the first one that actually parses
  // into the expected shape rather than assuming the first match is right.
  const scriptMatches = html.matchAll(/<script[^>]*>([^<]*FB_PUBLIC_LOAD_DATA_[\s\S]*?)<\/script>/g);
  let data: unknown = null;
  for (const m of scriptMatches) {
    const scriptContent = m[1];
    const firstBracket = scriptContent.indexOf('[');
    const lastSemi = scriptContent.lastIndexOf(';');
    if (firstBracket === -1 || lastSemi === -1 || lastSemi <= firstBracket) continue;
    try {
      const candidate = JSON.parse(scriptContent.slice(firstBracket, lastSemi).trim());
      if (Array.isArray(candidate) && Array.isArray(candidate[1])) {
        data = candidate;
        break;
      }
    } catch {
      // not this one — keep looking
    }
  }
  if (!data) {
    throw new Error("Couldn't read that form's structure — it may be private, deleted, or not accepting responses.");
  }
  if (!isArr(data) || !isArr(data[1])) {
    throw new Error('Unrecognized form format.');
  }
  const body = data[1] as unknown[];
  const items = isArr(body[1]) ? body[1] : [];

  const titleTagMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  const fallbackTitle = titleTagMatch ? titleTagMatch[1].replace(/\s*-\s*Google\s*Forms\s*$/i, '').trim() : '';
  const title = str(body[8]).trim() || fallbackTitle || 'Imported Google Form';
  const description = str(body[0]).trim();

  const sections: { title: string; description?: string }[] = [];
  const questions: QuestionnaireTemplate['questions'] = [];
  let currentSectionIndex: number | undefined;

  for (const rawItem of items) {
    if (!isArr(rawItem)) continue;
    const parsed = parseItem(rawItem);
    if (!parsed) continue;
    if (parsed.kind === 'section') {
      sections.push({ title: parsed.title, description: parsed.description || undefined });
      currentSectionIndex = sections.length - 1;
      continue;
    }
    const q = parsed.question!;
    const isChoice = q.type === 'mcq' || q.type === 'yesNo' || q.type === 'dropdown';
    questions.push({
      type: q.type,
      text: parsed.title,
      options: q.options,
      rows: q.rows,
      correctIndex: isChoice ? 0 : -1, // Google Forms exports don't carry an answer key — default to option A; admin marks the real answer after import.
      correctIndexes: q.type === 'checkbox' ? [] : undefined,
      scaleMax: q.scaleMax,
      points: isChoice || q.type === 'checkbox' ? 10 : 0,
      sectionIndex: currentSectionIndex,
    });
  }

  if (questions.length === 0) {
    throw new Error("That form doesn't have any importable questions.");
  }

  return { title, description: description || undefined, sections, questions };
}
