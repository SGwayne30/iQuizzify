'use client';
import type { Assessment, ResponseRecord, Question, CustomField } from '@/lib/types';
import { fmtDate, levelForPct } from '@/lib/utils';
import Portal from '@/components/Portal';

interface Props {
  assessment: Assessment;
  response: ResponseRecord;
  /** Admin-defined extra registration fields, so their answers can be shown alongside the built-in ones. */
  customFields?: CustomField[];
  onClose: () => void;
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

function answerLine(q: Question, response: ResponseRecord) {
  const ans = response.answers.find((a) => a.questionId === q.id);
  if (!ans) {
    return { body: <div className="qa-answer-line">No answer recorded.</div>, points: null as number | null };
  }

  if (q.type === 'checkbox') {
    const selected = ans.selectedIndexes || [];
    const hasKey = !!q.correctIndexes && q.correctIndexes.length > 0;
    const cls = hasKey ? (ans.correct ? 'qa-answer-line is-correct' : 'qa-answer-line is-incorrect') : 'qa-answer-line';
    const chosenText = selected.length
      ? selected.map((i) => `${LETTERS[i] ?? i + 1}. ${q.options[i] ?? ''}`).join('; ')
      : '(none selected)';
    return {
      body: (
        <>
          <div className={cls}>
            {hasKey ? (ans.correct ? '\u2713 ' : '\u2715 ') : ''}
            {chosenText}
          </div>
          {hasKey && !ans.correct && (
            <div className="qa-correct-note">
              Correct answer: {(q.correctIndexes || []).map((i) => `${LETTERS[i] ?? i + 1}. ${q.options[i] ?? ''}`).join('; ')}
            </div>
          )}
        </>
      ),
      points: ans.pointsEarned,
    };
  }

  if (q.type === 'paragraph' || q.type === 'shortAnswer') {
    return {
      body: <div className="qa-answer-line">{ans.textAnswer?.trim() ? ans.textAnswer : '(no response)'}</div>,
      points: null,
    };
  }

  if (q.type === 'date') {
    return { body: <div className="qa-answer-line">{ans.dateAnswer || '(no response)'}</div>, points: null };
  }

  if (q.type === 'time') {
    return { body: <div className="qa-answer-line">{ans.timeAnswer || '(no response)'}</div>, points: null };
  }

  if (q.type === 'fileUpload') {
    return {
      body: ans.fileAnswer ? (
        <div className="qa-answer-line">
          <a href={ans.fileAnswer.dataUrl} download={ans.fileAnswer.name}>
            {ans.fileAnswer.name}
          </a>{' '}
          &middot; {(ans.fileAnswer.size / 1024).toFixed(0)} KB
        </div>
      ) : (
        <div className="qa-answer-line">(no file uploaded)</div>
      ),
      points: null,
    };
  }

  if (q.type === 'linearScale') {
    const val = ans.selectedIndex;
    const label = val === q.scaleMax ? q.options[1] : val === 1 ? q.options[0] : undefined;
    return {
      body: (
        <div className="qa-answer-line">
          {val >= 0 ? `${val} / ${q.scaleMax || 5}` : '(no response)'}
          {label ? ` — ${label}` : ''}
        </div>
      ),
      points: null,
    };
  }

  if (q.type === 'rating') {
    const val = ans.selectedIndex;
    return {
      body: <div className="qa-answer-line">{val >= 0 ? `${'\u2605'.repeat(val)}${'\u2606'.repeat((q.scaleMax || 5) - val)}` : '(no response)'}</div>,
      points: null,
    };
  }

  if (q.type === 'mcqGrid' || q.type === 'checkboxGrid') {
    const rows = q.rows || [];
    return {
      body: (
        <div className="qa-grid-answer">
          {rows.map((row, ri) => {
            let text = '(no response)';
            if (q.type === 'mcqGrid') {
              const ci = ans.gridAnswers?.[ri];
              text = ci !== undefined ? q.options[ci] ?? '' : '(no response)';
            } else {
              const cis = ans.gridAnswersMulti?.[ri] || [];
              text = cis.length ? cis.map((ci) => q.options[ci] ?? '').join(', ') : '(no response)';
            }
            return (
              <div className="qa-grid-row" key={ri}>
                <span className="qa-grid-row-label">{row}</span>
                <span>{text}</span>
              </div>
            );
          })}
        </div>
      ),
      points: null,
    };
  }

  if (q.type === 'dropdown') {
    const chosen = q.options[ans.selectedIndex];
    const correctLabel = q.options[q.correctIndex];
    const hasKey = q.correctIndex >= 0;
    const cls = hasKey ? (ans.correct ? 'qa-answer-line is-correct' : 'qa-answer-line is-incorrect') : 'qa-answer-line';
    return {
      body: (
        <>
          <div className={cls}>
            {hasKey ? (ans.correct ? '\u2713 ' : '\u2715 ') : ''}
            {chosen ?? '(no response)'}
          </div>
          {hasKey && !ans.correct && <div className="qa-correct-note">Correct answer: {correctLabel}</div>}
        </>
      ),
      points: hasKey ? ans.pointsEarned : null,
    };
  }

  if (q.type === 'likert') {
    const label = q.options[ans.selectedIndex];
    return {
      body: <div className="qa-answer-line">{label ?? '(no response)'}</div>,
      points: null,
    };
  }

  // mcq
  const chosen = q.options[ans.selectedIndex];
  const correctLabel = q.options[q.correctIndex];
  const hasKey = q.correctIndex >= 0;
  if (!hasKey) {
    return {
      body: <div className="qa-answer-line">{LETTERS[ans.selectedIndex] ?? ''}. {chosen ?? '(no response)'}</div>,
      points: null,
    };
  }
  const cls = ans.correct ? 'qa-answer-line is-correct' : 'qa-answer-line is-incorrect';
  return {
    body: (
      <>
        <div className={cls}>
          {ans.correct ? '\u2713 ' : '\u2715 '}
          {LETTERS[ans.selectedIndex] ?? ''}. {chosen ?? '(no response)'}
        </div>
        {!ans.correct && (
          <div className="qa-correct-note">
            Correct answer: {LETTERS[q.correctIndex] ?? ''}. {correctLabel}
          </div>
        )}
      </>
    ),
    points: ans.pointsEarned,
  };
}

export default function RespondentModal({ assessment, response, customFields = [], onClose }: Props) {
  const pct = response.totalQuestions > 0 ? Math.round((response.correctCount / response.totalQuestions) * 100) : 0;
  const { level } = levelForPct(pct);
  const d = response.demographics;

  let lastSectionId: string | undefined;

  return (
    <Portal>
      <div
        className="modal-bg"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="modal modal-wide">
          <button className="modal-close" onClick={onClose}>
            &#10005;
          </button>
          <h2>{d.name || d.email || 'Respondent'}</h2>
          <p className="subtle-note" style={{ marginTop: -12, marginBottom: 4 }}>
            {assessment.title} &middot; Submitted {fmtDate(response.submittedAt)}
          </p>

          <div className="respondent-meta-grid">
            <div className="respondent-meta-item">
              <div className="l">Student number</div>
              <div className="v">{d.studentNumber || '—'}</div>
            </div>
            <div className="respondent-meta-item">
              <div className="l">Email</div>
              <div className="v">{d.email || '—'}</div>
            </div>
            <div className="respondent-meta-item">
              <div className="l">Course</div>
              <div className="v">{d.course || '—'}</div>
            </div>
            <div className="respondent-meta-item">
              <div className="l">Subject</div>
              <div className="v">{d.subject || '—'}</div>
            </div>
            {d.sex && (
              <div className="respondent-meta-item">
                <div className="l">Sex</div>
                <div className="v">{d.sex}</div>
              </div>
            )}
            <div className="respondent-meta-item">
              <div className="l">Gender</div>
              <div className="v">{d.gender || '—'}</div>
            </div>
            {d.civilStatus && (
              <div className="respondent-meta-item">
                <div className="l">Civil Status</div>
                <div className="v">{d.civilStatus}</div>
              </div>
            )}
            {d.age && (
              <div className="respondent-meta-item">
                <div className="l">Age Range</div>
                <div className="v">{d.age}</div>
              </div>
            )}
            {d.locality && (
              <div className="respondent-meta-item">
                <div className="l">Locality</div>
                <div className="v">{d.locality}</div>
              </div>
            )}
            {d.province && (
              <div className="respondent-meta-item">
                <div className="l">Province</div>
                <div className="v">{d.province}</div>
              </div>
            )}
            {d.region && (
              <div className="respondent-meta-item">
                <div className="l">Region</div>
                <div className="v">{d.region}</div>
              </div>
            )}
            {d.category && (
              <div className="respondent-meta-item">
                <div className="l">Institutional Category/Affiliation</div>
                <div className="v">{d.category}</div>
              </div>
            )}
            {d.org && (
              <div className="respondent-meta-item">
                <div className="l">Office/Institution/School</div>
                <div className="v">{d.org}</div>
              </div>
            )}
            {d.position && (
              <div className="respondent-meta-item">
                <div className="l">Designation</div>
                <div className="v">{d.position}</div>
              </div>
            )}
            {d.sector && (
              <div className="respondent-meta-item">
                <div className="l">Type of Sector</div>
                <div className="v">{d.sector}</div>
              </div>
            )}
            {customFields.map((cf) => (
              <div className="respondent-meta-item" key={cf.id}>
                <div className="l">{cf.label}</div>
                <div className="v">{d.custom?.[cf.id] || '—'}</div>
              </div>
            ))}
          </div>

          <div className="respondent-score-row">
            <div className="stat-chip">
              Score <b>{response.totalScore}</b>
            </div>
            <div className="stat-chip">
              Correct{' '}
              <b>
                {response.correctCount}/{response.totalQuestions}
              </b>
            </div>
            <div className="stat-chip">
              Accuracy <b>{pct}%</b>
            </div>
            <div className="stat-chip">
              Level <b>{level}</b>
            </div>

          </div>

          {assessment.questions.map((q, qi) => {
            const sec = assessment.sections?.find((s) => s.id === q.sectionId);
            const showSectionLabel = sec && sec.id !== lastSectionId;
            if (sec) lastSectionId = sec.id;
            const { body, points } = answerLine(q, response);
            return (
              <div className="respondent-qa" key={q.id}>
                {showSectionLabel && <div className="qa-section-label">{sec!.title}</div>}
                <p className="qa-qtext">
                  Q{qi + 1}. {q.text}
                  {points !== null && <span className="qa-points">{points} pts</span>}
                </p>
                {body}
              </div>
            );
          })}

          <div className="modal-actions">
            <button className="btn btn-primary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
