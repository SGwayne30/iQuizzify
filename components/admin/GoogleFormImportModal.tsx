'use client';
import { useState } from 'react';
import Portal from '@/components/Portal';

interface Props {
  busy: boolean;
  onClose: () => void;
  onImport: (url: string) => void;
}

export default function GoogleFormImportModal({ busy, onClose, onImport }: Props) {
  const [url, setUrl] = useState('');

  return (
    <Portal>
      <div
        className="modal-bg"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && !busy) onClose();
        }}
      >
        <div className="modal" style={{ maxWidth: 480 }}>
          <h2>Import from Google Forms</h2>
          <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>
            Paste the link to a public Google Form (shared as &quot;Anyone with the link&quot;). Its
            questions, choices, and pages will be imported as a new assessment — review it afterward to
            set correct answers and points.
          </p>
          <div className="field">
            <label>Google Form link</label>
            <input
              type="text"
              placeholder="https://docs.google.com/forms/d/e/.../viewform"
              value={url}
              autoFocus
              disabled={busy}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && url.trim() && !busy) onImport(url.trim());
              }}
            />
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || !url.trim()}
              onClick={() => onImport(url.trim())}
            >
              {busy ? 'Importing…' : 'Import'}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
