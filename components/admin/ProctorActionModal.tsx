'use client';
import { useState } from 'react';
import type { TabSwitchEvent } from '@/lib/types';
import { fmtDate } from '@/lib/utils';
import Portal from '@/components/Portal';

interface Props {
  /** The live alert the admin clicked — identifies the respondent and their switch count. */
  event: TabSwitchEvent;
  onClose: () => void;
  /** Applies the admin's decision. Resolves once the server has it, so the buttons can show progress. */
  onAction: (action: 'warn' | 'block' | 'clear', message: string) => Promise<void>;
}

const WARN_PLACEHOLDER =
  'Leave blank to send the standard warning, or write your own message for this student.';
const BLOCK_PLACEHOLDER =
  'Leave blank to use the standard message, or explain why their attempt is being ended.';

/**
 * Opens when an admin clicks one of the live "switched away from a
 * tab/window" alerts. Shows who the respondent is and what they've done so
 * far, then lets the admin choose: send a warning that interrupts their
 * screen, or block them outright and end the attempt.
 */
export default function ProctorActionModal({ event, onClose, onAction }: Props) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<'warn' | 'block' | 'clear' | null>(null);
  const [confirmingBlock, setConfirmingBlock] = useState(false);

  const label = event.email;
  const status = event.status ?? 'ok';
  const warnings = event.warnings ?? 0;

  async function run(action: 'warn' | 'block' | 'clear') {
    if (busy) return;
    // Blocking ends someone's attempt mid-assessment, so it takes a
    // deliberate second click rather than firing on the first.
    if (action === 'block' && !confirmingBlock) {
      setConfirmingBlock(true);
      return;
    }
    setBusy(action);
    try {
      await onAction(action, message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Portal>
      <div
        className="modal-bg"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && !busy) onClose();
        }}
      >
        <div className="modal">
          <button className="modal-close" onClick={onClose} disabled={!!busy}>
            &#10005;
          </button>
          <h2>Respondent activity</h2>
          <p className="subtle-note" style={{ marginTop: -12, marginBottom: 16 }}>
            {event.assessmentTitle}
          </p>

          <div className="proctor-identity">
            <div className="proctor-identity-main">{label}</div>
            {event.fullName && <div className="proctor-identity-sub">{event.fullName}</div>}
          </div>

          <div className="proctor-stat-row">
            <div className="stat-chip">
              Tab switches <b>{event.count}</b>
            </div>
            <div className="stat-chip">
              Warnings sent <b>{warnings}</b>
            </div>
            <div className={`proctor-status-chip is-${status}`}>
              {status === 'blocked' ? 'Blocked' : status === 'warned' ? 'Warned' : 'No action yet'}
            </div>
          </div>

          <p className="subtle-note" style={{ marginTop: 10 }}>
            First detected {fmtDate(event.firstAt)} &middot; last {fmtDate(event.updatedAt)}
          </p>

          <div className="field" style={{ marginTop: 18 }}>
            <label>Message to the student (optional)</label>
            <textarea
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={confirmingBlock ? BLOCK_PLACEHOLDER : WARN_PLACEHOLDER}
              disabled={!!busy}
            />
          </div>

          {confirmingBlock && (
            <div className="proctor-confirm-note">
              Blocking ends this attempt immediately. Their answers so far are not submitted, and they
              can&apos;t continue until you clear the block.
            </div>
          )}

          <div className="proctor-actions">
            <button
              className="btn btn-accent"
              onClick={() => run('warn')}
              disabled={!!busy}
              title="Interrupts their screen with a warning they have to dismiss"
            >
              {busy === 'warn' ? 'Sending\u2026' : '\u26A0 Send warning'}
            </button>
            <button
              className="btn btn-danger"
              onClick={() => run('block')}
              disabled={!!busy}
              title="Ends this attempt immediately"
            >
              {busy === 'block'
                ? 'Blocking\u2026'
                : confirmingBlock
                  ? 'Yes, block this student'
                  : '\u26D4 Block student'}
            </button>
            {status !== 'ok' && (
              <button className="btn btn-ghost" onClick={() => run('clear')} disabled={!!busy}>
                {busy === 'clear' ? 'Clearing\u2026' : 'Clear flag'}
              </button>
            )}
            <button className="btn btn-ghost" onClick={onClose} disabled={!!busy}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
