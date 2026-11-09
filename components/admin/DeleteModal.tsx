'use client';
import type { Assessment } from '@/lib/types';
import Portal from '@/components/Portal';

interface Props {
  assessment: Assessment;
  responseCount: number;
  onClose: () => void;
  onConfirm: () => void;
}

export default function DeleteModal({ assessment, responseCount, onClose, onConfirm }: Props) {
  return (
    <Portal>
      <div
        className="modal-bg"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="modal">
          <h2>Delete &quot;{assessment.title}&quot;?</h2>
          <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>
            This permanently removes the assessment and all {responseCount} recorded response(s).
            You&apos;ve already exported a copy, so this is safe to confirm.
          </p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn btn-danger"
              style={{ background: 'var(--danger)', color: '#fff', border: 'none' }}
              onClick={onConfirm}
            >
              Yes, delete permanently
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
