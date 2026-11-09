'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DB, ResponseRecord } from '@/lib/types';
import { fmtDate } from '@/lib/utils';
import { exportPDF, exportXLSX } from '@/lib/export';
import { saveDB, archiveResponses } from '@/lib/db';
import RespondentModal from './RespondentModal';
import Portal from '@/components/Portal';

type SortKey = 'submittedAt' | 'name' | 'email' | 'score' | 'correct';
const PAGE_SIZE = 10;

function SortableTh({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: 'asc' | 'desc';
  onSort: (k: SortKey) => void;
}) {
  const active = sortKey === activeKey;
  return (
    <th>
      <button type="button" className={`sort-th-btn${active ? ' active' : ''}`} onClick={() => onSort(sortKey)}>
        {label}
        <span className="sort-arrow">{active ? (dir === 'asc' ? '▲' : '▼') : ''}</span>
      </button>
    </th>
  );
}

interface Props {
  db: DB;
  refresh: () => void;
  showToast: (msg: string) => void;
  selectedAssessmentId: string | null;
  setSelectedAssessmentId: (id: string) => void;
  /** Recorded on the archive entry so it is clear who removed a response. */
  currentUsername?: string | null;
}

export default function ResponsesTab({
  db,
  refresh,
  showToast,
  selectedAssessmentId,
  setSelectedAssessmentId,
  currentUsername,
}: Props) {
  const [viewingResponse, setViewingResponse] = useState<ResponseRecord | null>(null);
  // Ids waiting for the "Remove?" confirmation (one row, or the whole selection).
  const [removingIds, setRemovingIds] = useState<string[] | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('submittedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastCheckedIndex = useRef<number | null>(null);
  const headerCheckRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!selectedAssessmentId && db.assessments[0]) {
      setSelectedAssessmentId(db.assessments[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.assessments]);

  const list = db.responses
    .filter((r) => r.assessmentId === selectedAssessmentId)
    .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());

  // Course / subject filters: configured choices plus any found on existing responses.
  const courseOptions = useMemo(
    () =>
      Array.from(
        new Set([...(db.fieldOptions.courses ?? []), ...list.map((r) => r.demographics.course || '').filter(Boolean)])
      ).sort((x, y) => x.localeCompare(y)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db.responses, db.fieldOptions.courses, selectedAssessmentId]
  );
  const subjectOptions = useMemo(
    () =>
      Array.from(
        new Set([...(db.fieldOptions.subjects ?? []), ...list.map((r) => r.demographics.subject || '').filter(Boolean)])
      ).sort((x, y) => x.localeCompare(y)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db.responses, db.fieldOptions.subjects, selectedAssessmentId]
  );
  const filteredList = list.filter(
    (r) =>
      (!courseFilter || (r.demographics.course || '') === courseFilter) &&
      (!subjectFilter || (r.demographics.subject || '') === subjectFilter)
  );
  const hasStudentNo = list.some((r) => r.demographics.studentNumber);
  // Old-style demographic columns only appear when at least one response actually has that data.
  const showDemo = list.some((r) => r.demographics.sex || r.demographics.region || r.demographics.sector || r.demographics.org);

  useEffect(() => {
    setPage(1);
  }, [selectedAssessmentId, searchQuery, sortKey, sortDir, courseFilter, subjectFilter]);
  useEffect(() => {
    setCourseFilter('');
    setSubjectFilter('');
  }, [selectedAssessmentId]);

  // A selection belongs to one assessment: switching assessments starts fresh.
  useEffect(() => {
    setSelected(new Set());
    lastCheckedIndex.current = null;
  }, [selectedAssessmentId]);

  // Search + sort + pagination (same behavior as "Individual responses" on Analytics).
  const tableRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const rows = filteredList.filter((r) => {
      if (!q) return true;
      return (
        (r.demographics.name || '').toLowerCase().includes(q) ||
        (r.demographics.email || '').toLowerCase().includes(q) ||
        (r.demographics.studentNumber || '').toLowerCase().includes(q) ||
        (r.demographics.org || '').toLowerCase().includes(q)
      );
    });
    return rows.slice().sort((x, y) => {
      let cmp = 0;
      if (sortKey === 'submittedAt') cmp = new Date(x.submittedAt).getTime() - new Date(y.submittedAt).getTime();
      else if (sortKey === 'name') cmp = (x.demographics.name || '').localeCompare(y.demographics.name || '');
      else if (sortKey === 'email') cmp = (x.demographics.email || '').localeCompare(y.demographics.email || '');
      else if (sortKey === 'correct') cmp = x.correctCount / x.totalQuestions - y.correctCount / y.totalQuestions;
      else cmp = x.totalScore - y.totalScore;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.responses, selectedAssessmentId, searchQuery, sortKey, sortDir, courseFilter, subjectFilter]);

  const totalPages = Math.max(1, Math.ceil(tableRows.length / PAGE_SIZE));
  const pageRows = tableRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // The live refresh can drop responses (removed elsewhere): forget selected ids that no longer exist.
  useEffect(() => {
    setSelected((current) => {
      if (current.size === 0) return current;
      const existing = new Set(db.responses.map((r) => r.id));
      const next = new Set([...current].filter((id) => existing.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [db.responses]);

  const pageIds = pageRows.map((r) => r.id);
  const pageSelectedCount = pageIds.filter((id) => selected.has(id)).length;
  const allPageSelected = pageIds.length > 0 && pageSelectedCount === pageIds.length;
  const allFilteredSelected = tableRows.length > 0 && tableRows.every((r) => selected.has(r.id));

  useEffect(() => {
    if (headerCheckRef.current) {
      headerCheckRef.current.indeterminate = pageSelectedCount > 0 && !allPageSelected;
    }
  }, [pageSelectedCount, allPageSelected]);

  function handleSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir('desc');
    }
  }

  function togglePage() {
    setSelected((current) => {
      const next = new Set(current);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }

  /** Ticks or unticks one row; holding Shift ticks the whole range since the last click, like a file list. */
  function toggleRow(index: number, id: string, shift: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      const last = lastCheckedIndex.current;
      if (shift && last !== null) {
        const [from, to] = last < index ? [last, index] : [index, last];
        const turnOn = !current.has(id);
        for (let i = from; i <= to; i++) {
          const rowId = pageRows[i]?.id;
          if (!rowId) continue;
          if (turnOn) next.add(rowId);
          else next.delete(rowId);
        }
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    lastCheckedIndex.current = index;
  }

  function selectAllFiltered() {
    setSelected(new Set(tableRows.map((r) => r.id)));
  }

  function clearSelection() {
    setSelected(new Set());
    lastCheckedIndex.current = null;
  }

  async function handleExportXlsx() {
    const a = db.assessments.find((x) => x.id === selectedAssessmentId);
    if (!a || filteredList.length === 0) {
      showToast('No responses to export yet.');
      return;
    }
    await exportXLSX(a, filteredList, db.fieldOptions.customFields);
    markExported(a.id);
  }

  function handleExportPdf() {
    const a = db.assessments.find((x) => x.id === selectedAssessmentId);
    if (!a || list.length === 0) {
      showToast('No responses to export yet.');
      return;
    }
    exportPDF(a, filteredList, null, db.fieldOptions.customFields);
    markExported(a.id);
  }

  function markExported(assessmentId: string) {
    const a = db.assessments.find((x) => x.id === assessmentId);
    if (a && !a.exported) {
      const next: DB = {
        ...db,
        assessments: db.assessments.map((x) => (x.id === assessmentId ? { ...x, exported: true } : x)),
      };
      // Persist directly via localStorage since we don't have `persist` here;
      // simplest: import saveDB and call, then refresh parent state.
      import('@/lib/db').then(({ saveDB }) => {
        saveDB(next);
        refresh();
        showToast('Exported. Permanent deletion is now unlocked for this assessment.');
      });
    }
  }

  async function confirmRemove() {
    if (!removingIds || removeBusy) return;
    setRemoveBusy(true);
    try {
      const { archived } = await archiveResponses(removingIds, currentUsername ?? undefined);
      setRemovingIds(null);
      setViewingResponse(null);
      clearSelection();
      refresh();
      showToast(
        archived === 1
          ? 'Response moved to the Archive. You can recover it there.'
          : `${archived} responses moved to the Archive. You can recover them there.`
      );
    } catch {
      showToast('Could not remove the response(s). Please try again.');
    } finally {
      setRemoveBusy(false);
    }
  }

  const removingResponses = removingIds ? db.responses.filter((r) => removingIds.includes(r.id)) : [];
  const removingOne = removingResponses.length === 1 ? removingResponses[0] : null;

  return (
    <div className="responses-glass">
      <div className="admin-header">
        <div>
          <h1>Responses</h1>
          <p>Raw submissions per assessment.</p>
        </div>
      </div>
      <div className="toolbar">
        <select
          className="select-inline"
          value={selectedAssessmentId ?? ''}
          onChange={(e) => setSelectedAssessmentId(e.target.value)}
        >
          {db.assessments.length === 0 && <option>No assessments yet</option>}
          {db.assessments.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title} ({a.code})
            </option>
          ))}
        </select>
        {courseOptions.length > 0 && (
          <select className="select-inline" value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)} aria-label="Filter by course">
            <option value="">All courses</option>
            {courseOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        {subjectOptions.length > 0 && (
          <select className="select-inline" value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)} aria-label="Filter by subject">
            <option value="">All subjects</option>
            {subjectOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        <button className="btn btn-accent btn-sm" onClick={handleExportXlsx}>
          Export Excel
        </button>
        <button className="btn btn-ghost btn-sm" onClick={handleExportPdf}>
          Export PDF summary
        </button>
      </div>
      {list.length === 0 ? (
        <div className="empty-state">
          <h3>No responses yet</h3>
          <p>Share the access code or QR poster to start collecting responses.</p>
        </div>
      ) : (
        <>
        <div className="toolbar">
          <input
            type="text"
            inputMode="search"
            autoComplete="off"
            className="search-inline"
            placeholder="Search by name, student number, or email…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <span className="subtle-note" style={{ marginLeft: 'auto', marginTop: 0 }}>
            {tableRows.length} response{tableRows.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="table-wrap">
          <table className="data-table responses-table">
            <thead>
              <tr>
                <th className="select-col">
                  <input
                    ref={headerCheckRef}
                    type="checkbox"
                    className="row-check"
                    aria-label="Select all responses on this page"
                    title="Select all on this page"
                    checked={allPageSelected}
                    onChange={togglePage}
                  />
                </th>
                <SortableTh label="Submitted" sortKey="submittedAt" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortableTh label="Name" sortKey="name" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortableTh label="Email" sortKey="email" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                {hasStudentNo && <th>Student No.</th>}
                {courseOptions.length > 0 && <th>Course</th>}
                {subjectOptions.length > 0 && <th>Subject</th>}
                {showDemo && (
                  <>
                    <th>Sex</th>
                    <th>Gender</th>
                    <th>Civil Status</th>
                    <th>Age Range</th>
                    <th>Locality</th>
                    <th>Province</th>
                    <th>Region</th>
                    <th>Inst. Category</th>
                    <th>Office/Institution/School</th>
                    <th>Designation</th>
                    <th>Sector</th>
                  </>
                )}
                {db.fieldOptions.customFields.map((cf) => (
                  <th key={cf.id}>{cf.label}</th>
                ))}
                <th>Score</th>
                <th>Correct</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r, index) => (
                <tr
                  key={r.id}
                  className={`row-clickable${selected.has(r.id) ? ' is-selected' : ''}`}
                  onClick={() => setViewingResponse(r)}
                >
                  <td className="select-col" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="row-check"
                      aria-label={`Select ${r.demographics.name || r.demographics.email || 'response'}`}
                      checked={selected.has(r.id)}
                      onChange={() => {}}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleRow(index, r.id, e.shiftKey);
                      }}
                    />
                  </td>
                  <td>{fmtDate(r.submittedAt)}</td>
                  <td>{r.demographics.name}</td>
                  <td>{r.demographics.email}</td>
                  {hasStudentNo && <td>{r.demographics.studentNumber || '—'}</td>}
                  {courseOptions.length > 0 && <td>{r.demographics.course || '—'}</td>}
                  {subjectOptions.length > 0 && <td>{r.demographics.subject || '—'}</td>}
                  {showDemo && (
                    <>
                      <td>{r.demographics.sex}</td>
                      <td>{r.demographics.gender}</td>
                      <td>{r.demographics.civilStatus}</td>
                      <td>{r.demographics.age}</td>
                      <td>{r.demographics.locality}</td>
                      <td>{r.demographics.province}</td>
                      <td>{r.demographics.region}</td>
                      <td>{r.demographics.category}</td>
                      <td>{r.demographics.org}</td>
                      <td>{r.demographics.position}</td>
                      <td>{r.demographics.sector}</td>
                    </>
                  )}
                  {db.fieldOptions.customFields.map((cf) => (
                    <td key={cf.id} data-label={cf.label}>{r.demographics.custom?.[cf.id] || '—'}</td>
                  ))}
                  <td>
                    {r.totalScore} pts{' '}
                    <span className="subtle-note" style={{ margin: 0 }}>
                      ({r.maxScore > 0 ? Math.round((r.totalScore / r.maxScore) * 100) : 0}%)
                    </span>
                  </td>
                  <td>
                    {r.correctCount}/{r.totalQuestions}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      title="Move this response to the Archive (you can recover it)"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRemovingIds([r.id]);
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="subtle-note" style={{ padding: '0 4px 12px' }}>
            Click any row to see that respondent&apos;s full set of answers. Tick rows to remove several at once
            (hold Shift to tick a range). Removed responses go to the Archive, where you can recover them.
          </p>
        </div>
        {totalPages > 1 && (
          <div className="pagination">
            <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              &#8592; Prev
            </button>
            <span className="subtle-note">
              Page {page} of {totalPages}
            </span>
            <button
              className="btn btn-ghost btn-sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next &#8594;
            </button>
          </div>
        )}

        {selected.size > 0 && (
          <div className="bulk-bar" role="region" aria-label="Selected responses">
            <span className="bulk-count">
              <strong>{selected.size}</strong> selected
            </span>
            {!allFilteredSelected && tableRows.length > selected.size && (
              <button type="button" className="bulk-link" onClick={selectAllFiltered}>
                Select all {tableRows.length}
              </button>
            )}
            <span className="bulk-spacer" />
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearSelection}>
              Clear
            </button>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => setRemovingIds([...selected])}>
              Remove selected
            </button>
          </div>
        )}
        </>
      )}

      {viewingResponse &&
        (() => {
          const a = db.assessments.find((x) => x.id === viewingResponse.assessmentId);
          if (!a) return null;
          return (
            <RespondentModal
              assessment={a}
              response={viewingResponse}
              customFields={db.fieldOptions.customFields}
              onClose={() => setViewingResponse(null)}
            />
          );
        })()}

      {removingIds && (
        <Portal>
          <div
            className="modal-bg"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget && !removeBusy) setRemovingIds(null);
            }}
          >
            <div className="modal">
              <h2>
                {removingOne
                  ? 'Remove this response?'
                  : `Remove ${removingIds.length} responses?`}
              </h2>
              <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>
                {removingOne
                  ? `${removingOne.demographics.name || removingOne.demographics.email || 'This participant'}'s response`
                  : `These ${removingIds.length} responses`}{' '}
                will move to the Archive. They stop counting in this assessment&apos;s responses and analytics, and you
                can recover them from <strong>Archive &rarr; Removed responses</strong> at any time; they go back into{' '}
                {currentAssessmentTitle(db, removingResponses)} exactly as they were.
              </p>
              <div className="modal-actions">
                <button className="btn btn-ghost" onClick={() => setRemovingIds(null)} disabled={removeBusy}>
                  Cancel
                </button>
                <button className="btn btn-danger" onClick={confirmRemove} disabled={removeBusy}>
                  {removeBusy ? 'Removing...' : removingOne ? 'Remove response' : `Remove ${removingIds.length} responses`}
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}

function currentAssessmentTitle(db: DB, responses: ResponseRecord[]) {
  const first = responses[0];
  const title = first ? db.assessments.find((a) => a.id === first.assessmentId)?.title : undefined;
  return title ? `“${title}”` : 'their assessment';
}
