'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ArchivedResponse, Assessment, DB } from '@/lib/types';
import { archiveDaysRemaining, fmtDate } from '@/lib/utils';
import { recoverResponses, purgeArchivedResponses, type RecoverSkipReason } from '@/lib/db';
import AssessmentCard from './AssessmentCard';
import AssessmentModal from './AssessmentModal';
import QrModal from './QrModal';
import DeleteModal from './DeleteModal';
import RespondentModal from './RespondentModal';
import Portal from '@/components/Portal';

interface Props {
  db: DB;
  persist: (next: DB) => void;
  refresh: () => void;
  showToast: (msg: string) => void;
  /** Used after a recovery so "View in Responses" opens the right assessment. */
  setSelectedAssessmentId: (id: string) => void;
  goToResponses: () => void;
}

type Section = 'assessments' | 'responses';
const PAGE_SIZE = 10;

const SKIP_TEXT: Record<RecoverSkipReason, string> = {
  'not-found': 'was already gone',
  'assessment-missing': 'belongs to an assessment that was deleted',
  'already-resubmitted': 'was not restored because that person has submitted this assessment again',
};

export default function ArchiveTab({ db, persist, showToast, refresh, setSelectedAssessmentId, goToResponses }: Props) {
  const [section, setSection] = useState<Section>('assessments');
  const [modalAssessment, setModalAssessment] = useState<Assessment | null>(null);
  const [qrAssessment, setQrAssessment] = useState<Assessment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Assessment | null>(null);

  const list = db.assessments.filter((a) => a.status === 'archived');
  const removed = db.archivedResponses ?? [];

  function recover(a: Assessment) {
    const next: DB = {
      ...db,
      assessments: db.assessments.map((x) => (x.id === a.id ? { ...x, status: 'active' } : x)),
    };
    persist(next);
    showToast('Assessment restored to active.');
  }

  function requestDelete(a: Assessment) {
    const daysRemaining = archiveDaysRemaining(a.archivedAt, a.createdAt);
    if (daysRemaining > 0) {
      showToast(`Delete will be available in ${daysRemaining} days.`);
      return;
    }
    if (!a.exported) {
      showToast('Export the responses first to unlock delete.');
      return;
    }
    setDeleteTarget(a);
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    const next: DB = {
      ...db,
      assessments: db.assessments.filter((x) => x.id !== deleteTarget.id),
      responses: db.responses.filter((r) => r.assessmentId !== deleteTarget.id),
    };
    persist(next);
    showToast('Assessment and responses deleted.');
    setDeleteTarget(null);
  }

  return (
    <div>
      <div className="admin-header">
        <div>
          <h1>Archive</h1>
          <p>
            Past training rounds and removed responses — recover them, or delete them for good once exported.
          </p>
        </div>
      </div>

      <div className="archive-switch" role="tablist" aria-label="Archive sections">
        <button
          type="button"
          role="tab"
          aria-selected={section === 'assessments'}
          className={section === 'assessments' ? 'active' : ''}
          onClick={() => setSection('assessments')}
        >
          Assessments <span className="archive-count">{list.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === 'responses'}
          className={section === 'responses' ? 'active' : ''}
          onClick={() => setSection('responses')}
        >
          Removed responses <span className="archive-count">{removed.length}</span>
        </button>
      </div>

      {section === 'assessments' ? (
        list.length === 0 ? (
          <div className="empty-state">
            <h3>Nothing archived yet</h3>
            <p>Archive a completed assessment from the Assessments tab.</p>
          </div>
        ) : (
          <div className="cards-grid">
            {list.map((a) => (
              <AssessmentCard
                key={a.id}
                a={a}
                db={db}
                onEdit={(x) => setModalAssessment(x)}
                onQr={(x) => setQrAssessment(x)}
                onViewResponses={() => {}}
                onRecover={recover}
                onDelete={requestDelete}
              />
            ))}
          </div>
        )
      ) : (
        <RemovedResponses
          db={db}
          removed={removed}
          refresh={refresh}
          showToast={showToast}
          setSelectedAssessmentId={setSelectedAssessmentId}
          goToResponses={goToResponses}
        />
      )}

      {modalAssessment && (
        <AssessmentModal
          db={db}
          existing={modalAssessment}
          onClose={() => setModalAssessment(null)}
          onSave={(next) => persist(next)}
          showToast={showToast}
        />
      )}
      {qrAssessment && (
        <QrModal assessment={qrAssessment} onClose={() => setQrAssessment(null)} showToast={showToast} />
      )}
      {deleteTarget && (
        <DeleteModal
          assessment={deleteTarget}
          responseCount={db.responses.filter((r) => r.assessmentId === deleteTarget.id).length}
          onClose={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}

// --- Removed responses ---------------------------------------------------

function RemovedResponses({
  db,
  removed,
  refresh,
  showToast,
  setSelectedAssessmentId,
  goToResponses,
}: {
  db: DB;
  removed: ArchivedResponse[];
  refresh: () => void;
  showToast: (msg: string) => void;
  setSelectedAssessmentId: (id: string) => void;
  goToResponses: () => void;
}) {
  const [assessmentFilter, setAssessmentFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [purgeIds, setPurgeIds] = useState<string[] | null>(null);
  const [viewing, setViewing] = useState<ArchivedResponse | null>(null);
  const [notice, setNotice] = useState<{ text: string; assessmentId?: string } | null>(null);
  const lastChecked = useRef<number | null>(null);
  const headerCheck = useRef<HTMLInputElement>(null);

  const titleOf = (id: string) => db.assessments.find((a) => a.id === id)?.title ?? 'Deleted assessment';

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of removed) map.set(r.assessmentId, (map.get(r.assessmentId) ?? 0) + 1);
    return map;
  }, [removed]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return removed.filter((r) => {
      if (assessmentFilter !== 'all' && r.assessmentId !== assessmentFilter) return false;
      if (!q) return true;
      return (
        (r.demographics.name || '').toLowerCase().includes(q) ||
        (r.demographics.email || '').toLowerCase().includes(q) ||
        (r.demographics.org || '').toLowerCase().includes(q)
      );
    });
  }, [removed, assessmentFilter, search]);

  useEffect(() => setPage(1), [assessmentFilter, search]);

  // Forget ticked rows that are no longer in the archive (recovered/deleted, here or from another screen).
  useEffect(() => {
    setSelected((current) => {
      if (current.size === 0) return current;
      const existing = new Set(removed.map((r) => r.id));
      const next = new Set([...current].filter((id) => existing.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [removed]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const pageIds = pageRows.map((r) => r.id);
  const pageSelected = pageIds.filter((id) => selected.has(id)).length;
  const allPageSelected = pageIds.length > 0 && pageSelected === pageIds.length;
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  useEffect(() => {
    if (headerCheck.current) headerCheck.current.indeterminate = pageSelected > 0 && !allPageSelected;
  }, [pageSelected, allPageSelected]);

  function togglePage() {
    setSelected((current) => {
      const next = new Set(current);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function toggleRow(index: number, id: string, shift: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      const last = lastChecked.current;
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
    lastChecked.current = index;
  }

  function clearSelection() {
    setSelected(new Set());
    lastChecked.current = null;
  }

  async function recover(ids: string[]) {
    if (busy || ids.length === 0) return;
    setBusy(true);
    setNotice(null);
    try {
      const { recovered, skipped } = await recoverResponses(ids);

      // Where did the restored ones go? If it is one assessment, offer to jump straight there.
      const restored = removed.filter((r) => ids.includes(r.id) && !skipped.some((s) => s.id === r.id));
      const targets = [...new Set(restored.map((r) => r.assessmentId))];

      const parts: string[] = [];
      if (recovered > 0) {
        parts.push(
          recovered === 1
            ? `1 response is back in ${targets[0] ? `“${titleOf(targets[0])}”` : 'its assessment'}.`
            : `${recovered} responses are back in ${
                targets.length === 1 ? `“${titleOf(targets[0])}”` : `${targets.length} assessments`
              }.`
        );
      }
      if (skipped.length > 0) {
        const reasons = [...new Set(skipped.map((s) => SKIP_TEXT[s.reason]))];
        parts.push(`${skipped.length} could not be recovered (${reasons.join('; ')}).`);
      }
      setNotice({ text: parts.join(' '), assessmentId: recovered > 0 && targets.length === 1 ? targets[0] : undefined });
      showToast(recovered > 0 ? `Recovered ${recovered} response${recovered === 1 ? '' : 's'}.` : 'Nothing was recovered.');
      clearSelection();
      setViewing(null);
      refresh();
    } catch {
      showToast('Could not recover the response(s). Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmPurge() {
    if (!purgeIds || busy) return;
    setBusy(true);
    try {
      const { purged, blocked } = await purgeArchivedResponses(purgeIds);
      setPurgeIds(null);
      clearSelection();
      refresh();
      if (blocked.length > 0) {
        const names = [...new Set(removed.filter((r) => blocked.includes(r.id)).map((r) => `“${titleOf(r.assessmentId)}”`))];
        showToast(
          `${purged} deleted. ${blocked.length} kept: export the responses of ${names.join(', ')} first to unlock permanent delete.`
        );
      } else {
        showToast(`${purged} response${purged === 1 ? '' : 's'} permanently deleted.`);
      }
    } catch {
      showToast('Could not delete the response(s). Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (removed.length === 0) {
    return (
      <div className="empty-state">
        <h3>No removed responses</h3>
        <p>Responses you remove from the Responses tab wait here, and can be recovered into their assessment.</p>
      </div>
    );
  }

  const viewingAssessment = viewing ? db.assessments.find((a) => a.id === viewing.assessmentId) : undefined;

  return (
    <div className="responses-glass">
      {notice && (
        <div className="archive-notice" role="status">
          <span>{notice.text}</span>
          {notice.assessmentId && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                setSelectedAssessmentId(notice.assessmentId as string);
                goToResponses();
              }}
            >
              View in Responses
            </button>
          )}
          <button type="button" className="archive-notice-close" aria-label="Dismiss" onClick={() => setNotice(null)}>
            &times;
          </button>
        </div>
      )}

      <div className="toolbar">
        <select className="select-inline" value={assessmentFilter} onChange={(e) => setAssessmentFilter(e.target.value)}>
          <option value="all">All assessments ({removed.length})</option>
          {[...counts.entries()].map(([id, n]) => (
            <option key={id} value={id}>
              {titleOf(id)} ({n})
            </option>
          ))}
        </select>
        <input
          type="text"
          inputMode="search"
          autoComplete="off"
          className="search-inline"
          placeholder="Search removed responses by name, email, or organization…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="subtle-note" style={{ marginLeft: 'auto', marginTop: 0 }}>
          {rows.length} removed response{rows.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="table-wrap">
        <table className="data-table responses-table">
          <thead>
            <tr>
              <th className="select-col">
                <input
                  ref={headerCheck}
                  type="checkbox"
                  className="row-check"
                  aria-label="Select all removed responses on this page"
                  title="Select all on this page"
                  checked={allPageSelected}
                  onChange={togglePage}
                />
              </th>
              <th>Removed</th>
              <th>Name</th>
              <th>Email</th>
              <th>Assessment</th>
              <th>Score</th>
              <th>Removed by</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: 28 }} className="subtle-note">
                  No removed responses match.
                </td>
              </tr>
            ) : (
              pageRows.map((r, index) => (
                <tr
                  key={r.id}
                  className={`row-clickable${selected.has(r.id) ? ' is-selected' : ''}`}
                  onClick={() => setViewing(r)}
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
                  <td>{fmtDate(r.archivedAt)}</td>
                  <td>{r.demographics.name}</td>
                  <td>{r.demographics.email}</td>
                  <td>{titleOf(r.assessmentId)}</td>
                  <td>
                    {r.totalScore} pts · {r.correctCount}/{r.totalQuestions}
                  </td>
                  <td>{r.archivedBy || '—'}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          recover([r.id]);
                        }}
                      >
                        Recover
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPurgeIds([r.id]);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <p className="subtle-note" style={{ padding: '0 4px 12px' }}>
          Recovering puts a response back into its original assessment with its answers and score unchanged. Tick rows
          to recover or delete several at once (hold Shift to tick a range).
        </p>
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button className="btn btn-ghost btn-sm" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
            &#8592; Prev
          </button>
          <span className="subtle-note">
            Page {currentPage} of {totalPages}
          </span>
          <button
            className="btn btn-ghost btn-sm"
            disabled={currentPage >= totalPages}
            onClick={() => setPage(currentPage + 1)}
          >
            Next &#8594;
          </button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="bulk-bar" role="region" aria-label="Selected removed responses">
          <span className="bulk-count">
            <strong>{selected.size}</strong> selected
          </span>
          {!allSelected && rows.length > selected.size && (
            <button type="button" className="bulk-link" onClick={() => setSelected(new Set(rows.map((r) => r.id)))}>
              Select all {rows.length}
            </button>
          )}
          <span className="bulk-spacer" />
          <button type="button" className="btn btn-ghost btn-sm" onClick={clearSelection} disabled={busy}>
            Clear
          </button>
          <button type="button" className="btn btn-danger btn-sm" onClick={() => setPurgeIds([...selected])} disabled={busy}>
            Delete permanently
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => recover([...selected])} disabled={busy}>
            {busy ? 'Recovering…' : 'Recover selected'}
          </button>
        </div>
      )}

      {viewing && viewingAssessment && (
        <RespondentModal
          assessment={viewingAssessment}
          response={viewing}
          customFields={db.fieldOptions.customFields}
          onClose={() => setViewing(null)}
        />
      )}

      {purgeIds && (
        <Portal>
          <div
            className="modal-bg"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget && !busy) setPurgeIds(null);
            }}
          >
            <div className="modal">
              <h2>{purgeIds.length === 1 ? 'Delete this response permanently?' : `Delete ${purgeIds.length} responses permanently?`}</h2>
              <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>
                This cannot be undone. Only responses whose assessment has already been exported can be deleted; the
                others stay in the archive.
              </p>
              <div className="modal-actions">
                <button className="btn btn-ghost" onClick={() => setPurgeIds(null)} disabled={busy}>
                  Cancel
                </button>
                <button className="btn btn-danger" onClick={confirmPurge} disabled={busy}>
                  {busy ? 'Deleting…' : 'Delete permanently'}
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}
