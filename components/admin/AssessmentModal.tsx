'use client';
import { useEffect, useRef, useState } from 'react';
import type { Assessment, Question, Section, DB } from '@/lib/types';
import { genCode, uid, LIKERT_PRESETS, QUESTION_TYPE_LABELS, CHOICE_TYPES, RATING_PRESETS, LINEAR_SCALE_PRESETS } from '@/lib/utils';
import { heartbeatPresence, clearPresence } from '@/lib/db';
import Portal from '@/components/Portal';

interface Props {
  db: DB;
  existing: Assessment | null;
  onClose: () => void;
  onSave: (next: DB) => void;
  showToast: (msg: string) => void;
  /** Signed-in admin's username — used to broadcast "I'm working on this" to other admins. */
  currentUsername?: string | null;
}

type Block =
  | { kind: 'section'; id: string; title: string; description: string }
  | { kind: 'question'; question: Question };

type PreviewAnswer = {
  selectedIndex?: number;
  selectedIndexes?: number[];
  text?: string;
};

interface DraftShape {
  title: string;
  topic: string;
  code: string;
  desc: string;
  blocks: Block[];
  settings?: { timeLimit: string; shuffleQ: boolean; shuffleO: boolean; showAns: boolean };
}

function draftKeyFor(existing: Assessment | null) {
  return existing ? `questiq_draft_edit_${existing.id}` : 'questiq_draft_new';
}

function loadDraft(key: string): DraftShape | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Migrate old drafts saved before sections existed (`questions` only).
    if (!parsed.blocks && Array.isArray(parsed.questions)) {
      parsed.blocks = parsed.questions.map((q: Question) => ({ kind: 'question', question: q }));
    }
    return parsed as DraftShape;
  } catch {
    return null;
  }
}

function newQuestion(): Question {
  return { id: uid('q'), type: 'mcq', text: '', required: true, options: ['', '', '', ''], correctIndex: 0, points: 10 };
}

function newSectionBlock(n: number): Block {
  return { kind: 'section', id: uid('sec'), title: `Section ${n}`, description: '' };
}

/** Reconstruct the editable block order from a saved assessment's flat question list + sections. */
function blocksFromExisting(existing: Assessment | null): Block[] {
  if (!existing) return [];
  const sections = existing.sections || [];
  const blocks: Block[] = [];
  let currentSectionId: string | undefined;
  for (const q of existing.questions) {
    if (q.sectionId && q.sectionId !== currentSectionId) {
      const sec = sections.find((s) => s.id === q.sectionId);
      if (sec) {
        blocks.push({ kind: 'section', id: sec.id, title: sec.title, description: sec.description || '' });
        currentSectionId = sec.id;
      }
    }
    blocks.push({ kind: 'question', question: JSON.parse(JSON.stringify(q)) });
  }
  return blocks;
}

/** Flatten the editable block order back into the saved shape: a question list + a section list. */
function blocksToParts(blocks: Block[]): { sections: Section[]; questions: Question[] } {
  const sections: Section[] = [];
  const questions: Question[] = [];
  let currentSectionId: string | undefined;
  for (const b of blocks) {
    if (b.kind === 'section') {
      currentSectionId = b.id;
      sections.push({
        id: b.id,
        title: b.title.trim() || `Section ${sections.length + 1}`,
        description: b.description.trim() || undefined,
      });
    } else {
      questions.push({ ...b.question, sectionId: currentSectionId });
    }
  }
  return { sections, questions };
}

export default function AssessmentModal({ db, existing, onClose, onSave, showToast, currentUsername }: Props) {
  const isEdit = !!existing;
  const draftKey = draftKeyFor(existing);
  const initialDraft = useState(() => loadDraft(draftKey))[0];

  const [title, setTitle] = useState(initialDraft?.title ?? existing?.title ?? '');
  const [topic, setTopic] = useState(initialDraft?.topic ?? existing?.topic ?? '');
  const [code, setCode] = useState(initialDraft?.code ?? existing?.code ?? genCode());
  const [desc, setDesc] = useState(initialDraft?.desc ?? existing?.description ?? '');
  // Per-quiz behaviour (timer, shuffling, whether students see the answer key).
  const [timeLimit, setTimeLimit] = useState(
    initialDraft?.settings?.timeLimit ?? (existing?.settings?.timeLimitMinutes ? String(existing.settings.timeLimitMinutes) : '')
  );
  const [shuffleQ, setShuffleQ] = useState(initialDraft?.settings?.shuffleQ ?? !!existing?.settings?.shuffleQuestions);
  const [shuffleO, setShuffleO] = useState(initialDraft?.settings?.shuffleO ?? !!existing?.settings?.shuffleOptions);
  const [showAns, setShowAns] = useState(initialDraft?.settings?.showAns ?? existing?.settings?.showAnswers !== false);
  const initialBlocks = initialDraft?.blocks ? initialDraft.blocks : blocksFromExisting(existing);
  const [blocks, setBlocksState] = useState<Block[]>(
    initialBlocks
  );
  const historyRef = useRef<Block[][]>([initialBlocks]);
  const historyIndexRef = useRef(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewAnswers, setPreviewAnswers] = useState<Record<string, PreviewAnswer>>({});

  function setBlocks(update: Block[] | ((current: Block[]) => Block[])) {
    setBlocksState((current) => {
      const next = typeof update === 'function' ? update(current) : update;
      const history = historyRef.current.slice(0, historyIndexRef.current + 1);
      history.push(next);
      historyRef.current = history;
      historyIndexRef.current = history.length - 1;
      return next;
    });
  }

  function undo() {
    if (historyIndexRef.current === 0) return;
    historyIndexRef.current -= 1;
    setBlocksState(historyRef.current[historyIndexRef.current]);
  }

  function redo() {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    setBlocksState(historyRef.current[historyIndexRef.current]);
  }

  const previewQuestions = blocks.filter(
    (block): block is Extract<Block, { kind: 'question' }> => block.kind === 'question'
  );
  const previewQuestion = previewQuestions[previewIndex]?.question;
  const previewAnswer = previewQuestion ? previewAnswers[previewQuestion.id] || {} : {};

  function openPreview() {
    setPreviewIndex(0);
    setPreviewAnswers({});
    setPreviewOpen(true);
  }

  function updatePreviewAnswer(questionId: string, answer: PreviewAnswer) {
    setPreviewAnswers((current) => ({ ...current, [questionId]: answer }));
  }

  function previewHasAnswer() {
    if (!previewQuestion) return false;
    if (previewQuestion.required === false) return true;
    if (previewQuestion.type === 'checkbox') return (previewAnswer.selectedIndexes || []).length > 0;
    if (previewQuestion.type === 'paragraph' || previewQuestion.type === 'shortAnswer') return !!previewAnswer.text?.trim();
    return previewAnswer.selectedIndex !== undefined || !!previewAnswer.text;
  }

  function nextPreviewQuestion() {
    if (!previewHasAnswer()) return;
    setPreviewIndex((index) => Math.min(index + 1, previewQuestions.length));
  }

  function previousPreviewQuestion() {
    setPreviewIndex((index) => Math.max(index - 1, 0));
  }

  // Let the person know their unsaved work was restored, once, on open.
  useEffect(() => {
    if (initialDraft) {
      showToast('Restored your unsaved draft — pick up where you left off.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave the in-progress assessment to localStorage so it survives an
  // accidental tab close, refresh, or browser crash mid-edit.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const t = window.setTimeout(() => {
      try {
        const draft: DraftShape = { title, topic, code, desc, blocks, settings: { timeLimit, shuffleQ, shuffleO, showAns } };
        window.localStorage.setItem(draftKey, JSON.stringify(draft));
      } catch {
        // storage full/unavailable — nothing we can do, skip silently
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [title, topic, code, desc, blocks, draftKey, timeLimit, shuffleQ, shuffleO, showAns]);

  function clearDraft() {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(draftKey);
    } catch {
      // ignore
    }
  }

  // Presence: let other signed-in admins see "X is creating/editing Y" in
  // near-real-time on the Assessments tab (see AssessmentsTab's presence
  // polling). Heartbeats every few seconds while this modal is open, using
  // a ref for the latest title so the interval doesn't need to be torn
  // down and rebuilt on every keystroke; clears the heartbeat on close.
  const titleRef = useRef(title);
  titleRef.current = title;
  useEffect(() => {
    if (!currentUsername) return;
    const assessmentId = existing?.id || 'new';
    const send = () =>
      heartbeatPresence({
        username: currentUsername,
        assessmentId,
        assessmentTitle: titleRef.current || existing?.title || 'Untitled',
        action: existing ? 'editing' : 'creating',
      });
    send();
    const interval = window.setInterval(send, 4000);
    return () => {
      window.clearInterval(interval);
      clearPresence(currentUsername);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUsername, existing?.id]);

  function addQuestion() {
    setBlocks((bs) => [...bs, { kind: 'question', question: newQuestion() }]);
  }
  function addSection() {
    setBlocks((bs) => [...bs, newSectionBlock(bs.filter((b) => b.kind === 'section').length + 1)]);
  }
  function removeBlock(bi: number) {
    setBlocks((bs) => bs.filter((_, i) => i !== bi));
  }
  function updateSection(bi: number, patch: Partial<{ title: string; description: string }>) {
    setBlocks((bs) =>
      bs.map((b, i) => (i === bi && b.kind === 'section' ? { ...b, ...patch } : b))
    );
  }
  function updateQuestion(bi: number, patch: Partial<Question>) {
    setBlocks((bs) =>
      bs.map((b, i) => (i === bi && b.kind === 'question' ? { ...b, question: { ...b.question, ...patch } } : b))
    );
  }
  function handleImageUpload(bi: number, file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('Please choose an image file.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      showToast('Image is too large — please use one under 2MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      updateQuestion(bi, { imageUrl: reader.result as string });
    };
    reader.readAsDataURL(file);
  }
  function updateOption(bi: number, oi: number, value: string) {
    setBlocks((bs) =>
      bs.map((b, i) => {
        if (i !== bi || b.kind !== 'question') return b;
        const options = [...b.question.options];
        options[oi] = value;
        return { ...b, question: { ...b.question, options } };
      })
    );
  }
  function toggleCorrectCheckbox(bi: number, oi: number) {
    setBlocks((bs) =>
      bs.map((b, i) => {
        if (i !== bi || b.kind !== 'question') return b;
        const cur = b.question.correctIndexes || [];
        const next = cur.includes(oi) ? cur.filter((x) => x !== oi) : [...cur, oi];
        return { ...b, question: { ...b.question, correctIndexes: next } };
      })
    );
  }

  function toggleChoiceScoring(bi: number) {
    setBlocks((bs) =>
      bs.map((b, i) => {
        if (i !== bi || b.kind !== 'question') return b;
        const isGraded = b.question.correctIndex >= 0;
        return {
          ...b,
          question: {
            ...b.question,
            correctIndex: isGraded ? -1 : 0,
            points: isGraded ? 0 : b.question.points || 10,
          },
        };
      })
    );
  }
  /** Build the fresh field set a question needs when its type changes, based on its previous shape where reusable. */
  function shapeForType(prev: Question, type: NonNullable<Question['type']>): Question {
    const base = { ...prev, type };
    switch (type) {
      case 'likert':
        return { ...base, options: [...LIKERT_PRESETS[5]], rows: undefined, correctIndex: -1, correctIndexes: [], points: 0, scaleMax: undefined };
      case 'checkbox':
        return {
          ...base,
          options: prev.options && prev.options.length >= 2 && (prev.type ? CHOICE_TYPES.includes(prev.type) : false) ? prev.options : ['', '', '', ''],
          rows: undefined,
          correctIndex: -1,
          correctIndexes: [],
          points: 10,
          scaleMax: undefined,
        };
      case 'yesNo':
        return {
          ...base,
          options: prev.type === 'yesNo' ? prev.options : ['Yes', 'No'],
          rows: undefined,
          correctIndex: 0,
          correctIndexes: undefined,
          points: 10,
          scaleMax: undefined,
        };
      case 'mcq':
      case 'dropdown':
        return {
          ...base,
          options: prev.options && prev.options.length >= 2 && (prev.type ? CHOICE_TYPES.includes(prev.type) : false) ? prev.options : ['', '', '', ''],
          rows: undefined,
          correctIndex: 0,
          correctIndexes: undefined,
          points: 10,
          scaleMax: undefined,
        };
      case 'paragraph':
      case 'shortAnswer':
      case 'date':
      case 'time':
        return { ...base, options: [], rows: undefined, correctIndex: -1, correctIndexes: undefined, points: 0, scaleMax: undefined };
      case 'fileUpload':
        return { ...base, options: [], rows: undefined, correctIndex: -1, correctIndexes: undefined, points: 0, scaleMax: undefined, fileTypes: prev.fileTypes };
      case 'linearScale':
        return { ...base, options: ['', ''], rows: undefined, correctIndex: -1, correctIndexes: undefined, points: 0, scaleMax: 5 };
      case 'rating':
        return { ...base, options: [], rows: undefined, correctIndex: -1, correctIndexes: undefined, points: 0, scaleMax: 5 };
      case 'mcqGrid':
      case 'checkboxGrid':
        return {
          ...base,
          options: prev.options && prev.options.length >= 2 ? prev.options : ['Column 1', 'Column 2'],
          rows: prev.rows && prev.rows.length >= 1 ? prev.rows : ['Row 1', 'Row 2'],
          correctIndex: -1,
          correctIndexes: undefined,
          points: 0,
          scaleMax: undefined,
        };
      default:
        return { ...base, options: ['', '', '', ''], rows: undefined, correctIndex: 0, correctIndexes: undefined, points: 10, scaleMax: undefined };
    }
  }

  function switchType(bi: number, type: Question['type']) {
    if (!type) return;
    setBlocks((bs) =>
      bs.map((b, i) => (i === bi && b.kind === 'question' ? { ...b, question: shapeForType(b.question, type) } : b))
    );
  }

  function addOption(bi: number) {
    setBlocks((bs) =>
      bs.map((b, i) => (i === bi && b.kind === 'question' ? { ...b, question: { ...b.question, options: [...b.question.options, ''] } } : b))
    );
  }

  function removeOption(bi: number, oi: number) {
    setBlocks((bs) =>
      bs.map((b, i) => {
        if (i !== bi || b.kind !== 'question') return b;
        if (b.question.options.length <= 2) return b; // keep at least 2 choices
        const options = b.question.options.filter((_, x) => x !== oi);
        const correctIndex =
          b.question.correctIndex === oi ? 0 : b.question.correctIndex > oi ? b.question.correctIndex - 1 : b.question.correctIndex;
        const correctIndexes = (b.question.correctIndexes || [])
          .filter((x) => x !== oi)
          .map((x) => (x > oi ? x - 1 : x));
        return { ...b, question: { ...b.question, options, correctIndex, correctIndexes } };
      })
    );
  }

  function addRow(bi: number) {
    setBlocks((bs) =>
      bs.map((b, i) => {
        if (i !== bi || b.kind !== 'question') return b;
        const rows = [...(b.question.rows || [])];
        rows.push(`Row ${rows.length + 1}`);
        return { ...b, question: { ...b.question, rows } };
      })
    );
  }

  function removeRow(bi: number, ri: number) {
    setBlocks((bs) =>
      bs.map((b, i) => {
        if (i !== bi || b.kind !== 'question') return b;
        const rows = b.question.rows || [];
        if (rows.length <= 1) return b; // keep at least 1 row
        return { ...b, question: { ...b.question, rows: rows.filter((_, x) => x !== ri) } };
      })
    );
  }

  function updateRow(bi: number, ri: number, value: string) {
    setBlocks((bs) =>
      bs.map((b, i) => {
        if (i !== bi || b.kind !== 'question') return b;
        const rows = [...(b.question.rows || [])];
        rows[ri] = value;
        return { ...b, question: { ...b.question, rows } };
      })
    );
  }

  function changeScale(bi: number, n: number) {
    setBlocks((bs) =>
      bs.map((b, i) => {
        if (i !== bi || b.kind !== 'question') return b;
        const preset = LIKERT_PRESETS[n] || LIKERT_PRESETS[5];
        const options = b.question.options.map((o, oi) => (o && o.trim() ? o : preset[oi])).slice(0, n);
        while (options.length < n) options.push(preset[options.length]);
        return { ...b, question: { ...b.question, options } };
      })
    );
  }

  function save() {
    const t = title.trim();
    const c = code.trim().toUpperCase();
    if (!t) {
      showToast('Please give the assessment a title.');
      return;
    }
    if (!c) {
      showToast('Please set an access code.');
      return;
    }
    const dup = db.assessments.find(
      (a) => a.code.toUpperCase() === c && (!existing || a.id !== existing.id)
    );
    if (dup) {
      showToast('That access code is already in use — pick another.');
      return;
    }
    const { sections, questions } = blocksToParts(blocks);
    const NO_OPTIONS_TYPES = ['paragraph', 'shortAnswer', 'fileUpload', 'rating', 'date', 'time'];
    const cleanQs = questions.filter((q) => {
      if (!q.text.trim()) return false;
      if (NO_OPTIONS_TYPES.includes(q.type || 'mcq')) return true;
      if (q.type === 'linearScale') return true; // endpoint labels are optional
      if (q.type === 'mcqGrid' || q.type === 'checkboxGrid') {
        return (q.rows || []).every((r) => r.trim()) && q.options.every((o) => o.trim());
      }
      return q.options.every((o) => o.trim());
    });
    if (cleanQs.length === 0) {
      showToast('Add at least one complete question (text + all options).');
      return;
    }
    const minutes = Math.floor(Number(timeLimit));
    const settings: Assessment['settings'] = {
      ...(minutes > 0 ? { timeLimitMinutes: Math.min(minutes, 600) } : {}),
      ...(shuffleQ ? { shuffleQuestions: true } : {}),
      ...(shuffleO ? { shuffleOptions: true } : {}),
      ...(showAns ? {} : { showAnswers: false }),
    };
    const next: DB = { ...db, assessments: [...db.assessments] };
    if (existing) {
      const idx = next.assessments.findIndex((a) => a.id === existing.id);
      next.assessments[idx] = {
        ...existing,
        title: t,
        topic,
        code: c,
        description: desc,
        sections,
        questions: cleanQs,
        settings,
      };
    } else {
      next.assessments.push({
        id: uid('assess'),
        title: t,
        topic,
        code: c,
        description: desc,
        sections,
        questions: cleanQs,
        settings,
        createdAt: new Date().toISOString(),
        status: 'active',
        exported: false,
      });
    }
    onSave(next);
    clearDraft();
    showToast(existing ? 'Assessment updated.' : 'Assessment created.');
    onClose();
  }

  let questionCounter = 0;

  return (
    <Portal>
      <div
        className="modal-bg"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className={`modal builder-modal${previewOpen ? ' builder-preview-open' : ''}`}>
        <button className="modal-close" onClick={onClose}>
          &#10005;
        </button>
        <div className="builder-toolbar">
          <div className="builder-toolbar-title">
            <h2>{previewOpen ? 'Preview' : isEdit ? 'Edit assessment' : 'New assessment'}</h2>
            <span>{previewOpen ? 'Participant view' : 'Form builder'}</span>
          </div>
          {!previewOpen && (
            <div className="builder-toolbar-actions">
              <button type="button" className="icon-btn" onClick={undo} disabled={historyIndexRef.current === 0} title="Undo" aria-label="Undo">
                &#8630;
              </button>
              <button type="button" className="icon-btn" onClick={redo} disabled={historyIndexRef.current >= historyRef.current.length - 1} title="Redo" aria-label="Redo">
                &#8631;
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={openPreview}>
                Preview
              </button>
            </div>
          )}
          {previewOpen && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPreviewOpen(false)}>
              Back to editor
            </button>
          )}
        </div>
        {previewOpen ? (
          <div className="builder-preview">
            {previewQuestions.length === 0 ? (
              <div className="preview-intro">
                <span className="eyebrow">{topic || 'Assessment preview'}</span>
                <h1>{title || 'Untitled assessment'}</h1>
                <p>Add questions to see the participant preview.</p>
              </div>
            ) : previewIndex >= previewQuestions.length ? (
              <div className="preview-complete">
                <div className="thank-you-mark" aria-hidden="true">&#10003;</div>
                <span className="eyebrow">PREVIEW COMPLETE</span>
                <h1>Thank you for answering</h1>
                <p>This is how the completion message will appear to participants.</p>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPreviewIndex(0)}>
                  Restart preview
                </button>
              </div>
            ) : (
              <>
                <div className="preview-intro">
                  <span className="eyebrow">{topic || 'Assessment preview'}</span>
                  <h1>{title || 'Untitled assessment'}</h1>
                  {desc && <p>{desc}</p>}
                  <div className="preview-progress">Question {previewIndex + 1} of {previewQuestions.length}</div>
                </div>
                <div className="preview-question">
                  <div className="qmeta">Question {previewIndex + 1}</div>
                  <h3>{previewQuestion?.text || 'Untitled question'}</h3>
                  {previewQuestion?.required === false && <span className="preview-optional">Optional</span>}
                  {(previewQuestion?.type === 'mcq' || previewQuestion?.type === 'yesNo' || previewQuestion?.type === 'dropdown' || !previewQuestion?.type) && (
                    <div className="preview-options">
                      {previewQuestion.options.map((option, optionIndex) => (
                        <button
                          type="button"
                          className={`preview-option${previewAnswer.selectedIndex === optionIndex ? ' selected' : ''}`}
                          key={optionIndex}
                          onClick={() => updatePreviewAnswer(previewQuestion.id, { selectedIndex: optionIndex })}
                        >
                          {previewQuestion.type !== 'mcq' && previewQuestion.type !== 'yesNo' && (
                            <span className="preview-option-marker">{String.fromCharCode(65 + optionIndex)}</span>
                          )}
                          {option || `Option ${optionIndex + 1}`}
                        </button>
                      ))}
                    </div>
                  )}
                  {previewQuestion?.type === 'likert' && (
                    <div className="preview-options">
                      {previewQuestion.options.map((option, optionIndex) => (
                        <button type="button" className={`preview-option${previewAnswer.selectedIndex === optionIndex ? ' selected' : ''}`} key={optionIndex} onClick={() => updatePreviewAnswer(previewQuestion.id, { selectedIndex: optionIndex })}>
                          <span className="preview-option-marker">{optionIndex + 1}</span>{option}
                        </button>
                      ))}
                    </div>
                  )}
                  {previewQuestion?.type === 'checkbox' && (
                    <div className="preview-options">
                      {previewQuestion.options.map((option, optionIndex) => {
                        const selected = (previewAnswer.selectedIndexes || []).includes(optionIndex);
                        return <button type="button" className={`preview-option${selected ? ' selected' : ''}`} key={optionIndex} onClick={() => updatePreviewAnswer(previewQuestion.id, { selectedIndexes: selected ? (previewAnswer.selectedIndexes || []).filter((index) => index !== optionIndex) : [...(previewAnswer.selectedIndexes || []), optionIndex] })}><span className="preview-option-marker">{selected ? '\u2713' : ''}</span>{option || `Option ${optionIndex + 1}`}</button>;
                      })}
                    </div>
                  )}
                  {(previewQuestion?.type === 'paragraph' || previewQuestion?.type === 'shortAnswer') && (
                    <textarea className="preview-answer-input" rows={previewQuestion.type === 'paragraph' ? 4 : 1} placeholder="Type your answer here..." value={previewAnswer.text || ''} onChange={(event) => updatePreviewAnswer(previewQuestion.id, { text: event.target.value })} />
                  )}
                  {(previewQuestion?.type === 'date' || previewQuestion?.type === 'time') && (
                    <input className="preview-answer-input" type={previewQuestion.type} value={previewAnswer.text || ''} onChange={(event) => updatePreviewAnswer(previewQuestion.id, { text: event.target.value })} />
                  )}
                  {previewQuestion?.type === 'linearScale' && (
                    <div className="preview-scale-options">{Array.from({ length: previewQuestion.scaleMax || 5 }, (_, index) => index + 1).map((value) => <button type="button" className={`preview-scale-button${previewAnswer.selectedIndex === value ? ' selected' : ''}`} key={value} onClick={() => updatePreviewAnswer(previewQuestion.id, { selectedIndex: value })}>{value}</button>)}</div>
                  )}
                  {previewQuestion?.type === 'rating' && (
                    <div className="preview-rating-options">{Array.from({ length: previewQuestion.scaleMax || 5 }, (_, index) => index + 1).map((value) => <button type="button" className={`preview-rating-button${previewAnswer.selectedIndex === value ? ' selected' : ''}`} key={value} onClick={() => updatePreviewAnswer(previewQuestion.id, { selectedIndex: value })}>&#9733;</button>)}</div>
                  )}
                  {previewQuestion?.type === 'fileUpload' && <div className="preview-input">File upload is represented here in preview.</div>}
                </div>
                <div className="preview-navigation">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={previousPreviewQuestion} disabled={previewIndex === 0}>Previous</button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={nextPreviewQuestion} disabled={!previewHasAnswer()}>{previewIndex + 1 === previewQuestions.length ? 'Finish preview' : 'Next'} &#9656;</button>
                </div>
              </>
            )}
          </div>
        ) : null}
        {!previewOpen && <>
        <p className="subtle-note" style={{ marginTop: -12, marginBottom: 18 }}>
          Autosaving as you type — safe to close and come back.{' '}
          <button
            type="button"
            className="tiny-btn"
            style={{ color: 'var(--text-faint)', textDecoration: 'underline' }}
            onClick={() => {
              clearDraft();
              setTitle(existing?.title ?? '');
              setTopic(existing?.topic ?? '');
              setCode(existing?.code ?? genCode());
              setDesc(existing?.description ?? '');
              setTimeLimit(existing?.settings?.timeLimitMinutes ? String(existing.settings.timeLimitMinutes) : '');
              setShuffleQ(!!existing?.settings?.shuffleQuestions);
              setShuffleO(!!existing?.settings?.shuffleOptions);
              setShowAns(existing?.settings?.showAnswers !== false);
              setBlocks(blocksFromExisting(existing));
              showToast('Draft discarded.');
            }}
          >
            Discard draft
          </button>
        </p>
        <div className="field">
          <label>Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Data Privacy Fundamentals"
          />
        </div>
        <div className="grid-2">
          <div className="field">
            <label>Topic</label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. Cybersecurity"
            />
          </div>
          <div className="field">
            <label>Access code</label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              style={{ fontFamily: 'var(--font-mono)', letterSpacing: 2, textTransform: 'uppercase' }}
            />
          </div>
        </div>
        <div className="field">
          <label>Description (shown to participants)</label>
          <textarea rows={5} value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>
        <div className="field quiz-settings">
          <label>Quiz settings</label>
          <div className="quiz-settings-grid">
            <div className="qs-item">
              <div className="qs-text">
                <b>Time limit</b>
                <span>Auto-submits when time runs out. Leave empty for no limit.</span>
              </div>
              <div className="qs-time">
                <input
                  type="number"
                  min={1}
                  max={600}
                  inputMode="numeric"
                  placeholder="None"
                  value={timeLimit}
                  onChange={(e) => setTimeLimit(e.target.value.replace(/[^0-9]/g, ''))}
                />
                <span>min</span>
              </div>
            </div>
            <label className="qs-item qs-toggle">
              <div className="qs-text">
                <b>Shuffle questions</b>
                <span>Each student sees the questions in a different order (kept within sections).</span>
              </div>
              <input type="checkbox" checked={shuffleQ} onChange={(e) => setShuffleQ(e.target.checked)} />
            </label>
            <label className="qs-item qs-toggle">
              <div className="qs-text">
                <b>Shuffle answer choices</b>
                <span>Multiple-choice, checkbox and dropdown options appear in random order.</span>
              </div>
              <input type="checkbox" checked={shuffleO} onChange={(e) => setShuffleO(e.target.checked)} />
            </label>
            <label className="qs-item qs-toggle">
              <div className="qs-text">
                <b>Show correct answers to students</b>
                <span>Off = students only see their score; no answer key, explanations or live right/wrong feedback.</span>
              </div>
              <input type="checkbox" checked={showAns} onChange={(e) => setShowAns(e.target.checked)} />
            </label>
          </div>
        </div>
        <div className="field">
          <label>Questions</label>
          <div>
            {blocks.length === 0 && <p className="subtle-note">No questions yet — add at least one.</p>}
            {blocks.map((b, bi) => {
              if (b.kind === 'section') {
                return (
                  <div className="section-block" key={b.id}>
                    <div className="qbuild-head">
                      <span>&#9776; SECTION</span>
                      <button className="tiny-btn" onClick={() => removeBlock(bi)} type="button">
                        Remove section
                      </button>
                    </div>
                    <div className="field" style={{ marginBottom: 10 }}>
                      <input
                        type="text"
                        placeholder="Section title"
                        value={b.title}
                        onChange={(e) => updateSection(bi, { title: e.target.value })}
                      />
                    </div>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <input
                        type="text"
                        placeholder="Section description (optional, shown to participants)"
                        value={b.description}
                        onChange={(e) => updateSection(bi, { description: e.target.value })}
                      />
                    </div>
                  </div>
                );
              }

              const q = b.question;
              questionCounter += 1;
              const qNum = questionCounter;
              const isLikert = q.type === 'likert';
              const isCheckbox = q.type === 'checkbox';
              const isParagraph = q.type === 'paragraph';
              const isMcqOrDropdown = q.type === 'mcq' || q.type === 'yesNo' || q.type === 'dropdown' || !q.type;
              const isChoiceType = isCheckbox || isMcqOrDropdown;
              return (
                <div className="qbuild" key={q.id}>
                  <div className="qbuild-head">
                    <span>QUESTION {qNum}</span>
                    <button className="tiny-btn" onClick={() => removeBlock(bi)} type="button">
                      Remove
                    </button>
                  </div>
                  <div className="qtype-row">
                    <label
                      style={{
                        display: 'block',
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: 'var(--text-dim)',
                        marginBottom: 5,
                        textTransform: 'uppercase',
                        letterSpacing: 0.3,
                      }}
                    >
                      Question type
                    </label>
                    <select
                      value={q.type || 'mcq'}
                      onChange={(e) => switchType(bi, e.target.value as Question['type'])}
                    >
                      <optgroup label="Choice">
                        <option value="mcq">Multiple Choice</option>
                        <option value="yesNo">Yes / No</option>
                        <option value="checkbox">Checkboxes (select multiple)</option>
                        <option value="dropdown">Dropdown</option>
                      </optgroup>
                      <optgroup label="Text">
                        <option value="shortAnswer">Short Answer</option>
                        <option value="paragraph">Paragraph (open text)</option>
                      </optgroup>
                      <optgroup label="Scale">
                        <option value="likert">Likert Scale</option>
                        <option value="linearScale">Linear Scale</option>
                        <option value="rating">Rating</option>
                      </optgroup>
                      <optgroup label="Grid">
                        <option value="mcqGrid">Multiple Choice Grid</option>
                        <option value="checkboxGrid">Checkbox Grid</option>
                      </optgroup>
                      <optgroup label="Other">
                        <option value="fileUpload">File Upload</option>
                        <option value="date">Date</option>
                        <option value="time">Time</option>
                      </optgroup>
                    </select>
                  </div>
                  <div className="field" style={{ marginBottom: 10 }}>
                    <input
                      type="text"
                      placeholder="Question text"
                      value={q.text}
                      onChange={(e) => updateQuestion(bi, { text: e.target.value })}
                    />
                  </div>
                  <button
                    type="button"
                    className="required-toggle"
                    aria-pressed={q.required !== false}
                    onClick={() => updateQuestion(bi, { required: q.required === false })}
                    style={{ marginBottom: 14 }}
                  >
                    <span className="required-toggle-track" aria-hidden="true">
                      <span className="required-toggle-thumb" />
                    </span>
                    <span>{q.required === false ? 'Optional answer' : 'Required answer'}</span>
                  </button>
                  <div className="field" style={{ marginBottom: 10 }}>
                    <label>Image (optional)</label>
                    {q.imageUrl ? (
                      <div className="qimg-preview">
                        <img src={q.imageUrl} alt="" />
                        <button
                          type="button"
                          className="tiny-btn"
                          onClick={() => updateQuestion(bi, { imageUrl: undefined })}
                        >
                          Remove image
                        </button>
                      </div>
                    ) : (
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleImageUpload(bi, e.target.files?.[0])}
                      />
                    )}
                  </div>
                  {(isParagraph || q.type === 'shortAnswer') && (
                    <p className="subtle-note">
                      {q.type === 'shortAnswer' ? 'Short answer' : 'Paragraph'} questions collect a
                      free-text answer from participants and aren&apos;t scored as correct or incorrect.
                    </p>
                  )}
                  {q.type === 'date' && (
                    <p className="subtle-note">
                      Date questions collect a calendar date and aren&apos;t scored as correct or
                      incorrect.
                    </p>
                  )}
                  {q.type === 'time' && (
                    <p className="subtle-note">
                      Time questions collect a time of day and aren&apos;t scored as correct or
                      incorrect.
                    </p>
                  )}
                  {q.type === 'fileUpload' && (
                    <>
                      <div className="field" style={{ maxWidth: 320, marginBottom: 6 }}>
                        <label>Accepted file types (optional)</label>
                        <input
                          type="text"
                          placeholder="e.g. .pdf,.jpg,.png (leave blank to accept any file)"
                          value={q.fileTypes || ''}
                          onChange={(e) => updateQuestion(bi, { fileTypes: e.target.value })}
                        />
                      </div>
                      <p className="subtle-note">
                        File upload questions collect a document from participants and aren&apos;t
                        scored as correct or incorrect.
                      </p>
                    </>
                  )}
                  {isLikert && (
                    <>
                      <div className="field" style={{ maxWidth: 160, marginBottom: 10 }}>
                        <label>Scale points</label>
                        <select
                          value={q.options.length}
                          onChange={(e) => changeScale(bi, parseInt(e.target.value))}
                        >
                          <option value={3}>3-point</option>
                          <option value={5}>5-point</option>
                          <option value={7}>7-point</option>
                        </select>
                      </div>
                      {q.options.map((opt, oi) => (
                        <div className="opt-row" key={oi}>
                          <span className="opt-num">{oi + 1}</span>
                          <input
                            type="text"
                            placeholder={`Label ${oi + 1}`}
                            value={opt}
                            onChange={(e) => updateOption(bi, oi, e.target.value)}
                          />
                        </div>
                      ))}
                      <p className="subtle-note">
                        Likert questions collect opinion/agreement data from participants and aren&apos;t
                        scored as correct or incorrect.
                      </p>
                    </>
                  )}
                  {q.type === 'linearScale' && (
                    <>
                      <div className="field" style={{ maxWidth: 160, marginBottom: 10 }}>
                        <label>Scale points</label>
                        <select
                          value={q.scaleMax || 5}
                          onChange={(e) => updateQuestion(bi, { scaleMax: parseInt(e.target.value) })}
                        >
                          {LINEAR_SCALE_PRESETS.map((n) => (
                            <option key={n} value={n}>
                              1 to {n}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="grid-2">
                        <div className="field" style={{ marginBottom: 0 }}>
                          <input
                            type="text"
                            placeholder="Label for 1 (optional)"
                            value={q.options[0] || ''}
                            onChange={(e) => updateOption(bi, 0, e.target.value)}
                          />
                        </div>
                        <div className="field" style={{ marginBottom: 0 }}>
                          <input
                            type="text"
                            placeholder={`Label for ${q.scaleMax || 5} (optional)`}
                            value={q.options[1] || ''}
                            onChange={(e) => updateOption(bi, 1, e.target.value)}
                          />
                        </div>
                      </div>
                      <p className="subtle-note">
                        Linear scale questions collect a numeric rating and aren&apos;t scored as
                        correct or incorrect.
                      </p>
                    </>
                  )}
                  {q.type === 'rating' && (
                    <>
                      <div className="field" style={{ maxWidth: 160, marginBottom: 10 }}>
                        <label>Max rating</label>
                        <select
                          value={q.scaleMax || 5}
                          onChange={(e) => updateQuestion(bi, { scaleMax: parseInt(e.target.value) })}
                        >
                          {RATING_PRESETS.map((n) => (
                            <option key={n} value={n}>
                              {n} stars
                            </option>
                          ))}
                        </select>
                      </div>
                      <p className="subtle-note">
                        Rating questions collect a star rating and aren&apos;t scored as correct or
                        incorrect.
                      </p>
                    </>
                  )}
                  {(q.type === 'mcqGrid' || q.type === 'checkboxGrid') && (
                    <>
                      <label
                        style={{
                          display: 'block',
                          fontSize: 11.5,
                          fontWeight: 600,
                          color: 'var(--text-dim)',
                          marginBottom: 5,
                          textTransform: 'uppercase',
                          letterSpacing: 0.3,
                        }}
                      >
                        Rows
                      </label>
                      {(q.rows || []).map((row, ri) => (
                        <div className="opt-row" key={ri}>
                          <input
                            type="text"
                            placeholder={`Row ${ri + 1}`}
                            value={row}
                            onChange={(e) => updateRow(bi, ri, e.target.value)}
                          />
                          <button
                            type="button"
                            className="tiny-btn"
                            disabled={(q.rows || []).length <= 1}
                            onClick={() => removeRow(bi, ri)}
                          >
                            &#10005;
                          </button>
                        </div>
                      ))}
                      <button className="btn btn-ghost btn-sm" type="button" onClick={() => addRow(bi)} style={{ marginBottom: 14 }}>
                        + Add row
                      </button>
                      <label
                        style={{
                          display: 'block',
                          fontSize: 11.5,
                          fontWeight: 600,
                          color: 'var(--text-dim)',
                          marginBottom: 5,
                          textTransform: 'uppercase',
                          letterSpacing: 0.3,
                        }}
                      >
                        Columns
                      </label>
                      {q.options.map((opt, oi) => (
                        <div className="opt-row" key={oi}>
                          <input
                            type="text"
                            placeholder={`Column ${oi + 1}`}
                            value={opt}
                            onChange={(e) => updateOption(bi, oi, e.target.value)}
                          />
                          <button
                            type="button"
                            className="tiny-btn"
                            disabled={q.options.length <= 2}
                            onClick={() => removeOption(bi, oi)}
                          >
                            &#10005;
                          </button>
                        </div>
                      ))}
                      <button className="btn btn-ghost btn-sm" type="button" onClick={() => addOption(bi)}>
                        + Add column
                      </button>
                      <p className="subtle-note" style={{ marginTop: 10 }}>
                        {q.type === 'checkboxGrid'
                          ? 'Checkbox grid lets participants pick multiple columns per row.'
                          : 'Multiple choice grid lets participants pick one column per row.'}{' '}
                        Grid questions aren&apos;t scored as correct or incorrect.
                      </p>
                    </>
                  )}
                  {isCheckbox && (
                    <>
                      {q.options.map((opt, oi) => (
                        <div className="opt-row" key={oi}>
                          <input
                            type="checkbox"
                            checked={(q.correctIndexes || []).includes(oi)}
                            onChange={() => toggleCorrectCheckbox(bi, oi)}
                          />
                          <input
                            type="text"
                            placeholder={`Option ${String.fromCharCode(65 + oi)}`}
                            value={opt}
                            onChange={(e) => updateOption(bi, oi, e.target.value)}
                          />
                          <button
                            type="button"
                            className="tiny-btn"
                            disabled={q.options.length <= 2}
                            onClick={() => removeOption(bi, oi)}
                          >
                            &#10005;
                          </button>
                        </div>
                      ))}
                      <button className="btn btn-ghost btn-sm" type="button" onClick={() => addOption(bi)}>
                        + Add option
                      </button>
                      <p className="subtle-note">
                        Tick the checkbox next to every correct option (optional — leave all unticked
                        for an ungraded checkbox question). A response earns full points only when it
                        selects exactly the ticked options.
                      </p>
                      <div className="field" style={{ maxWidth: 140, marginTop: 8 }}>
                        <label>Points</label>
                        <input
                          type="text"
                          value={q.points}
                          onChange={(e) => updateQuestion(bi, { points: parseInt(e.target.value) || 0 })}
                        />
                      </div>
                    </>
                  )}
                  {(isMcqOrDropdown) && (
                    <>
                      <button
                        type="button"
                        className="required-toggle"
                        aria-pressed={q.correctIndex >= 0}
                        onClick={() => toggleChoiceScoring(bi)}
                        style={{ marginBottom: 10 }}
                      >
                        <span className="required-toggle-track" aria-hidden="true">
                          <span className="required-toggle-thumb" />
                        </span>
                        <span>{q.correctIndex >= 0 ? 'Has a correct answer' : 'No correct answer'}</span>
                      </button>
                      {q.options.map((opt, oi) => (
                        <div className={`opt-row${q.correctIndex === oi ? ' answer-key-selected' : ''}`} key={oi}>
                          <input
                            type="radio"
                            name={`correct_${bi}`}
                            checked={q.correctIndex === oi}
                            disabled={q.correctIndex < 0}
                            onChange={() => updateQuestion(bi, { correctIndex: oi })}
                          />
                          <input
                            type="text"
                            placeholder={`Option ${String.fromCharCode(65 + oi)}`}
                            value={opt}
                            onChange={(e) => updateOption(bi, oi, e.target.value)}
                          />
                          <button
                            type="button"
                            className="tiny-btn"
                            disabled={q.options.length <= 2}
                            onClick={() => removeOption(bi, oi)}
                          >
                            &#10005;
                          </button>
                        </div>
                      ))}
                      <button className="btn btn-ghost btn-sm" type="button" onClick={() => addOption(bi)}>
                        + Add option
                      </button>
                      <div className="field" style={{ maxWidth: 140, marginTop: 8 }}>
                        <label>Points</label>
                        <input
                          type="text"
                          value={q.points}
                          onChange={(e) => updateQuestion(bi, { points: parseInt(e.target.value) || 10 })}
                        />
                      </div>
                      {q.correctIndex < 0 && (
                        <p className="subtle-note">Use this mode for Yes / No / Maybe questions where every answer is valid and responses are not scored.</p>
                      )}
                    </>
                  )}
                  {isChoiceType && (q.type === 'checkbox' ? true : q.correctIndex >= 0) && (
                    <div className="field" style={{ marginTop: 8 }}>
                      <label>Explanation (optional)</label>
                      <textarea
                        placeholder="Shown to participants after they submit, to explain why the correct answer is correct."
                        value={q.explanation || ''}
                        onChange={(e) => updateQuestion(bi, { explanation: e.target.value })}
                        rows={2}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost btn-sm" onClick={addQuestion} type="button">
              + Add question
            </button>
            <button className="btn btn-ghost btn-sm" onClick={addSection} type="button">
              + Add section
            </button>
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save}>
            {isEdit ? 'Save changes' : 'Create assessment'}
          </button>
        </div>
        </>}
      </div>
      </div>
    </Portal>
  );
}