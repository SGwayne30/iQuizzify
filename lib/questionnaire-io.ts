import type { Assessment, Question, Section, QuestionType } from './types';
import { uid } from './utils';

/** Portable shape of an assessment's questionnaire, with no ids, code, or response data — safe to share/import. */
export interface QuestionnaireTemplate {
  title: string;
  topic?: string;
  description?: string;
  sections?: { title: string; description?: string }[];
  questions: (Omit<Question, 'id' | 'sectionId'> & { sectionIndex?: number })[];
}

const VALID_TYPES: QuestionType[] = [
  'mcq',
  'yesNo',
  'checkbox',
  'likert',
  'paragraph',
  'shortAnswer',
  'dropdown',
  'fileUpload',
  'linearScale',
  'rating',
  'mcqGrid',
  'checkboxGrid',
  'date',
  'time',
];

/** Strip an assessment down to a shareable questionnaire template and trigger a JSON download. */
export function exportQuestionnaireJSON(a: Assessment) {
  const sections = a.sections || [];
  const sectionIndexById = new Map(sections.map((s, i) => [s.id, i]));
  const template: QuestionnaireTemplate = {
    title: a.title,
    topic: a.topic,
    description: a.description,
    sections: sections.map((s) => ({ title: s.title, description: s.description })),
    questions: a.questions.map((q) => {
      const { id, sectionId, ...rest } = q;
      const out: QuestionnaireTemplate['questions'][number] = { ...rest };
      if (sectionId && sectionIndexById.has(sectionId)) out.sectionIndex = sectionIndexById.get(sectionId);
      return out;
    }),
  };
  const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${(a.code || a.title || 'questionnaire').replace(/[^a-z0-9-]+/gi, '_')}.json`;
  link.click();
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export interface QuestionnaireDraft {
  title: string;
  topic: string;
  description: string;
  sections: Section[];
  questions: Question[];
}

/**
 * Validates a raw questionnaire-shaped object (already-parsed JSON, from a
 * file or from an import endpoint) and returns fresh Section/Question
 * objects with new ids. Shared by the JSON file importer and the Google
 * Forms importer so both get the same validation and id-assignment logic.
 */
export function templateToDraft(raw: unknown): QuestionnaireDraft {
  if (!isPlainObject(raw)) throw new Error('Unrecognized questionnaire file format.');
  const title = typeof raw.title === 'string' ? raw.title : '';
  const topic = typeof raw.topic === 'string' ? raw.topic : '';
  const description = typeof raw.description === 'string' ? raw.description : '';
  const rawSections = Array.isArray(raw.sections) ? raw.sections : [];
  const sections: Section[] = rawSections
    .filter(isPlainObject)
    .map((s) => ({
      id: uid('sec'),
      title: typeof s.title === 'string' && s.title.trim() ? s.title : 'Section',
      description: typeof s.description === 'string' && s.description.trim() ? s.description : undefined,
    }));
  const rawQuestions = Array.isArray(raw.questions) ? raw.questions : [];
  if (rawQuestions.length === 0) throw new Error('That file has no questions in it.');
  const questions: Question[] = rawQuestions.filter(isPlainObject).map((q) => {
    const type: QuestionType = VALID_TYPES.includes(q.type as QuestionType) ? (q.type as QuestionType) : 'mcq';
    const sectionIndex = typeof q.sectionIndex === 'number' ? q.sectionIndex : undefined;
    const sectionId =
      sectionIndex !== undefined && sections[sectionIndex] ? sections[sectionIndex].id : undefined;
    return {
      id: uid('q'),
      type,
      text: typeof q.text === 'string' ? q.text : '',
      required: q.required !== false,
      imageUrl: typeof q.imageUrl === 'string' ? q.imageUrl : undefined,
      options: Array.isArray(q.options) ? q.options.filter((o): o is string => typeof o === 'string') : [],
      rows: Array.isArray(q.rows) ? q.rows.filter((r): r is string => typeof r === 'string') : undefined,
      correctIndex: typeof q.correctIndex === 'number' ? q.correctIndex : -1,
      correctIndexes: Array.isArray(q.correctIndexes)
        ? q.correctIndexes.filter((i): i is number => typeof i === 'number')
        : undefined,
      scaleMax: typeof q.scaleMax === 'number' ? q.scaleMax : undefined,
      fileTypes: typeof q.fileTypes === 'string' ? q.fileTypes : undefined,
      points: typeof q.points === 'number' ? q.points : 0,
      sectionId,
    };
  });
  if (questions.every((q) => !q.text.trim())) {
    throw new Error("That file's questions don't have any text.");
  }
  return { title, topic, description, sections, questions };
}

/** Read and validate a questionnaire JSON file, returning fresh Section/Question objects with new ids. */
export async function parseQuestionnaireFile(file: File): Promise<QuestionnaireDraft> {
  const text = await file.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  return templateToDraft(raw);
}
