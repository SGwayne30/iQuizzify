'use client';
import { useEffect, useState } from 'react';
import type { Assessment, DB, PresenceEntry } from '@/lib/types';
import { archiveDaysRemaining, genCode, uid } from '@/lib/utils';
import { fetchPresence } from '@/lib/db';
import AssessmentCard from './AssessmentCard';
import AssessmentModal from './AssessmentModal';
import QrModal from './QrModal';
import DeleteModal from './DeleteModal';

interface Props {
  db: DB;
  persist: (next: DB) => void;
  refresh: () => void;
  showToast: (msg: string) => void;
  onViewResponses: (id: string) => void;
  currentUsername: string | null;
}

const LIST_POLL_MS = 5000;
const PRESENCE_POLL_MS = 4000;

export default function AssessmentsTab({ db, persist, refresh, showToast, onViewResponses, currentUsername }: Props) {
  const [modalAssessment, setModalAssessment] = useState<Assessment | null | 'new'>(null);
  const [qrAssessment, setQrAssessment] = useState<Assessment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Assessment | null>(null);
  const [presence, setPresence] = useState<PresenceEntry[]>([]);

  const modalOpen = modalAssessment !== null;

  // Live list sync: while nobody's mid-edit in this tab, quietly pull the
  // latest assessments on a timer so a newly created/edited questionnaire
  // from another admin's account shows up here without needing a manual
  // refresh or re-login. Paused whenever a modal is open (own edit in
  // progress, or reviewing a QR/delete dialog) so a background refresh
  // never yanks data out from under someone typing, and paused when the
  // tab is backgrounded.
  useEffect(() => {
    if (modalOpen) return;
    let cancelled = false;
    function poll() {
      if (document.hidden || cancelled) return;
      refresh();
    }
    const interval = window.setInterval(poll, LIST_POLL_MS);
    document.addEventListener('visibilitychange', poll);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen]);

  // Presence: see who else is currently creating/editing a questionnaire.
  // Keeps polling even while this admin's own modal is open, so the
  // moment someone else starts editing the same assessment it shows up.
  useEffect(() => {
    let cancelled = false;
    function poll() {
      if (document.hidden || cancelled) return;
      fetchPresence().then((entries) => {
        if (!cancelled) setPresence(entries);
      });
    }
    poll();
    const interval = window.setInterval(poll, PRESENCE_POLL_MS);
    document.addEventListener('visibilitychange', poll);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', poll);
    };
  }, []);

  const othersPresence = presence.filter((p) => p.username !== currentUsername);
  const editingByAssessmentId = new Map(othersPresence.filter((p) => p.action === 'editing').map((p) => [p.assessmentId, p.username]));
  const creatingOthers = othersPresence.filter((p) => p.action === 'creating');

  const active = db.assessments.filter((a) => a.status === 'active');

  function archive(a: Assessment) {
    const archivedAt = new Date().toISOString();
    const next: DB = {
      ...db,
      assessments: db.assessments.map((x) => (x.id === a.id ? { ...x, status: 'archived', archivedAt } : x)),
    };
    persist(next);
    showToast('Assessment archived.');
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

  function requestDelete(a: Assessment) {
    if (a.status === 'archived' && archiveDaysRemaining(a.archivedAt, a.createdAt) > 0) {
      showToast(`Delete will be available in ${archiveDaysRemaining(a.archivedAt, a.createdAt)} days.`);
      return;
    }
    if (!a.exported) {
      showToast('Export the responses first to unlock delete.');
      return;
    }
    setDeleteTarget(a);
  }

  function openEdit(a: Assessment) {
    const editor = editingByAssessmentId.get(a.id);
    if (editor) {
      showToast(`Heads up — ${editor} is already editing this. Your changes could conflict with theirs.`);
    }
    setModalAssessment(a);
  }

  return (
    <div>
      <div className="admin-header">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            Assessments
          </h1>
          <p>Create assessments, set access codes, and generate QR posters for participants.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => setModalAssessment('new')}>
            + New assessment
          </button>
        </div>
      </div>

      {creatingOthers.length > 0 && (
        <div className="presence-banner">
          <span className="live-dot" />
          {creatingOthers.map((p) => p.username).join(', ')}{' '}
          {creatingOthers.length === 1 ? 'is' : 'are'} creating a new assessment right now — it&apos;ll
          appear here once saved.
        </div>
      )}

      {active.length === 0 ? (
        <div className="empty-state">
          <h3>No active assessments yet</h3>
          <p>Create one to generate an access code and QR poster for participants.</p>
        </div>
      ) : (
        <div className="cards-grid">
          {active.map((a) => (
            <AssessmentCard
              key={a.id}
              a={a}
              db={db}
              onEdit={openEdit}
              onQr={(x) => setQrAssessment(x)}
              onViewResponses={onViewResponses}
              onArchive={archive}
              onDelete={requestDelete}
              editingByOther={editingByAssessmentId.get(a.id)}
            />
          ))}
        </div>
      )}

      {modalAssessment && (
        <AssessmentModal
          db={db}
          existing={modalAssessment === 'new' ? null : modalAssessment}
          onClose={() => setModalAssessment(null)}
          onSave={(next) => {
            persist(next);
          }}
          showToast={showToast}
          currentUsername={currentUsername}
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
