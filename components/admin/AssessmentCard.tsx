'use client';
import { useRef } from 'react';
import type { Assessment, DB } from '@/lib/types';
import { archiveDaysRemaining, fmtDate } from '@/lib/utils';

// Small line-icons for the icon-only card actions (Edit / QR / Archive).
const EditIcon = () => (
  <svg viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M11.6 2.9 15.1 6.4 6 15.5H2.5V12L11.6 2.9Z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <path d="M9.9 4.6 13.4 8.1" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

const QrIcon = () => (
  <svg viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="2.5" y="2.5" width="5" height="5" rx="0.8" stroke="currentColor" strokeWidth="1.4" />
    <rect x="10.5" y="2.5" width="5" height="5" rx="0.8" stroke="currentColor" strokeWidth="1.4" />
    <rect x="2.5" y="10.5" width="5" height="5" rx="0.8" stroke="currentColor" strokeWidth="1.4" />
    <rect x="4.4" y="4.4" width="1.2" height="1.2" fill="currentColor" />
    <rect x="12.4" y="4.4" width="1.2" height="1.2" fill="currentColor" />
    <rect x="4.4" y="12.4" width="1.2" height="1.2" fill="currentColor" />
    <path d="M10.5 10.5h2.2v2.2h-2.2zM13.8 10.5h1.7v1.7h-1.7zM10.5 13.8h1.7v1.7h-1.7zM13.6 13.6h1.9v1.9h-1.9z" fill="currentColor" />
  </svg>
);

const ArchiveIcon = () => (
  <svg viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="2.5" y="2.5" width="13" height="3" rx="0.9" stroke="currentColor" strokeWidth="1.4" />
    <path d="M3.6 5.9h10.8v7.6a1.4 1.4 0 0 1-1.4 1.4H5a1.4 1.4 0 0 1-1.4-1.4V5.9Z" stroke="currentColor" strokeWidth="1.4" />
    <path d="M7.2 8.9h3.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);


// --- Click animations (Web Animations API, so the global reduced-motion
// override in globals.css can't flatten them) ------------------------------
const EASE = 'cubic-bezier(.16,1,.3,1)';

function ripple(btn: HTMLElement, e: React.MouseEvent, color: string) {
  const r = btn.getBoundingClientRect();
  const size = Math.max(r.width, r.height) * 2.2;
  const cx = e.clientX || r.left + r.width / 2;
  const cy = e.clientY || r.top + r.height / 2;
  const prevOverflow = btn.style.overflow;
  const prevPos = btn.style.position;
  if (getComputedStyle(btn).position === 'static') btn.style.position = 'relative';
  btn.style.overflow = 'hidden';
  const dot = document.createElement('span');
  Object.assign(dot.style, {
    position: 'absolute', left: `${cx - r.left - size / 2}px`, top: `${cy - r.top - size / 2}px`,
    width: `${size}px`, height: `${size}px`, borderRadius: '50%', background: color, pointerEvents: 'none',
  });
  btn.appendChild(dot);
  dot.animate(
    [
      { transform: 'scale(0)', opacity: 0.9 },
      { transform: 'scale(1)', opacity: 0 },
    ],
    { duration: 560, easing: 'ease-out' }
  ).onfinish = () => {
    dot.remove();
    btn.style.overflow = prevOverflow;
    btn.style.position = prevPos;
  };
}

// Pencil tilts and scribbles.
function animEdit(btn: HTMLElement) {
  btn.querySelector('svg')?.animate(
    [
      { transform: 'rotate(0) translate(0,0)' },
      { transform: 'rotate(-28deg) translate(-2px,1px)', offset: 0.25 },
      { transform: 'rotate(14deg) translate(2px,-1px)', offset: 0.55 },
      { transform: 'rotate(-8deg)', offset: 0.8 },
      { transform: 'rotate(0) translate(0,0)' },
    ],
    { duration: 460, easing: 'ease-in-out' }
  );
}

// QR icon pops while a scan line sweeps down the button.
function animQr(btn: HTMLElement) {
  btn.querySelector('svg')?.animate(
    [
      { transform: 'scale(1)' },
      { transform: 'scale(0.78)', offset: 0.3 },
      { transform: 'scale(1.18)', offset: 0.65 },
      { transform: 'scale(1)' },
    ],
    { duration: 480, easing: EASE }
  );
  const prevOverflow = btn.style.overflow;
  const prevPos = btn.style.position;
  if (getComputedStyle(btn).position === 'static') btn.style.position = 'relative';
  btn.style.overflow = 'hidden';
  const line = document.createElement('span');
  Object.assign(line.style, {
    position: 'absolute', left: '6px', right: '6px', top: '0', height: '2px', borderRadius: '2px',
    background: 'var(--primary)', boxShadow: '0 0 8px 1px rgba(65,161,127,.7)', pointerEvents: 'none',
  });
  btn.appendChild(line);
  line.animate(
    [
      { transform: 'translateY(2px)', opacity: 0 },
      { transform: 'translateY(8px)', opacity: 1, offset: 0.15 },
      { transform: `translateY(${btn.clientHeight - 10}px)`, opacity: 1, offset: 0.85 },
      { transform: `translateY(${btn.clientHeight - 4}px)`, opacity: 0 },
    ],
    { duration: 480, easing: 'ease-in-out' }
  ).onfinish = () => {
    line.remove();
    btn.style.overflow = prevOverflow;
    btn.style.position = prevPos;
  };
}

// Archive box lid drops, then the whole card folds away.
function animArchive(btn: HTMLElement, card: HTMLElement | null) {
  btn.querySelector('svg')?.animate(
    [
      { transform: 'translateY(0) scale(1)' },
      { transform: 'translateY(-4px) scale(1.1)', offset: 0.3 },
      { transform: 'translateY(2px) scale(0.9)', offset: 0.65 },
      { transform: 'translateY(0) scale(1)' },
    ],
    { duration: 380, easing: EASE }
  );
  if (!card) return;
  const a = card.animate(
    [
      { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0)' },
      { opacity: 0, transform: 'translateY(18px) scale(0.92)', filter: 'blur(3px)' },
    ],
    { duration: 380, delay: 120, easing: 'cubic-bezier(.7,0,.3,1)', fill: 'forwards' }
  );
  // If the archive doesn't actually remove the card, bring it back.
  window.setTimeout(() => a.cancel(), 1200);
}

// Responses / Recover: shine sweep + a small card nudge as the view changes.
function animPrimary(btn: HTMLElement, card: HTMLElement | null) {
  btn.animate(
    [
      { transform: 'scale(1)' },
      { transform: 'scale(0.94)', offset: 0.35 },
      { transform: 'scale(1.04)', offset: 0.7 },
      { transform: 'scale(1)' },
    ],
    { duration: 380, easing: EASE }
  );
  card?.animate(
    [
      { transform: 'translateY(0) scale(1)' },
      { transform: 'translateY(-3px) scale(1.012)', offset: 0.5 },
      { transform: 'translateY(0) scale(1)' },
    ],
    { duration: 380, easing: EASE }
  );
}

interface Props {
  a: Assessment;
  db: DB;
  onEdit: (a: Assessment) => void;
  onQr: (a: Assessment) => void;
  onViewResponses: (id: string) => void;
  onArchive?: (a: Assessment) => void;
  onRecover?: (a: Assessment) => void;
  onDelete: (a: Assessment) => void;
  onExportJson?: (a: Assessment) => void;
  /** Username of another admin currently editing this assessment, if any (see AssessmentsTab's presence polling). */
  editingByOther?: string;
}

export default function AssessmentCard({
  a,
  db,
  onEdit,
  onQr,
  onViewResponses,
  onArchive,
  onRecover,
  onDelete,
  editingByOther,
}: Props) {
  const respCount = db.responses.filter((r) => r.assessmentId === a.id).length;
  const archiveDays = a.status === 'archived' ? archiveDaysRemaining(a.archivedAt, a.createdAt) : 0;
  const cardRef = useRef<HTMLDivElement>(null);
  const busy = useRef(false);

  // Plays the button's animation, then runs the action after `delay` ms so the
  // motion is actually seen before a modal opens / the view changes.
  function act(
    e: React.MouseEvent<HTMLButtonElement>,
    kind: 'edit' | 'qr' | 'archive' | 'primary',
    run: () => void,
    delay: number
  ) {
    if (busy.current) return;
    busy.current = true;
    const btn = e.currentTarget;
    ripple(btn, e, kind === 'primary' ? 'rgba(255,255,255,.45)' : 'rgba(65,161,127,.22)');
    if (kind === 'edit') animEdit(btn);
    else if (kind === 'qr') animQr(btn);
    else if (kind === 'archive') animArchive(btn, cardRef.current);
    else animPrimary(btn, cardRef.current);
    window.setTimeout(() => {
      busy.current = false;
      run();
    }, delay);
  }

  return (
    <div className="a-card" ref={cardRef}>
      <div className="a-card-head">
        <h3>{a.title}</h3>
        <div className="topic">
          {a.topic || '—'} &middot; {a.questions.length} question{a.questions.length !== 1 ? 's' : ''}
        </div>
        <div className="a-card-meta">
          <span>
            {respCount} response{respCount !== 1 ? 's' : ''}
          </span>
          <span>Created {fmtDate(a.createdAt)}</span>
        </div>
      </div>
      <div className="code-tag">{a.code}</div>
      <div className="a-card-badges">
        {a.status === 'archived' ? (
          <span className="badge badge-archived">Archived</span>
        ) : (
          <span className="badge badge-active">Active</span>
        )}
        {a.exported && <span className="badge badge-exported">Exported</span>}
      </div>
      {editingByOther && (
        <div className="editing-badge" title="Their changes will sync here once they save">
          <span className="live-dot" />
          {editingByOther} is editing this now
        </div>
      )}
      {a.status === 'archived' && (
        <div className="archive-retention-note">
          {archiveDays > 0 ? `Delete available in ${archiveDays} day${archiveDays === 1 ? '' : 's'}` : 'Delete available now'}
        </div>
      )}
      <div className="a-card-actions">
        <button className="btn btn-sm btn-ghost btn-icon" title="Edit" aria-label="Edit" onClick={(e) => act(e, 'edit', () => onEdit(a), 240)}>
          <EditIcon />
        </button>
        <button className="btn btn-sm btn-ghost btn-icon" title="QR / Code" aria-label="QR / Code" onClick={(e) => act(e, 'qr', () => onQr(a), 300)}>
          <QrIcon />
        </button>
        {a.status === 'active' && onArchive && (
          <button className="btn btn-sm btn-ghost btn-icon" title="Archive" aria-label="Archive" onClick={(e) => act(e, 'archive', () => onArchive(a), 420)}>
            <ArchiveIcon />
          </button>
        )}
        <button className="btn btn-sm btn-accent a-card-primary" onClick={(e) => act(e, 'primary', () => onViewResponses(a.id), 260)}>
          Responses ({respCount})
        </button>
        {a.status === 'archived' && onRecover && (
          <button className="btn btn-sm btn-accent a-card-primary" onClick={(e) => act(e, 'primary', () => onRecover(a), 320)}>
            Recover
          </button>
        )}
        {a.status === 'archived' && archiveDays === 0 && (
          <button
            className="btn btn-sm btn-danger"
            disabled={!a.exported}
            title={a.exported ? 'Delete assessment and its responses' : 'Export responses first to unlock delete'}
            onClick={() => onDelete(a)}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}