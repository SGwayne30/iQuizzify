'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import QRCode from 'qrcode';
import type { Assessment } from '@/lib/types';
import Portal from '@/components/Portal';

interface Props {
  assessment: Assessment;
  onClose: () => void;
  showToast: (msg: string) => void;
}

export default function QrModal({ assessment, onClose, showToast }: Props) {
  // Portal renders null on its first render (it waits for its own
  // useEffect to mount into document.body), so the <canvas> below doesn't
  // exist in the DOM on QrModal's first commit. A plain useRef would stay
  // null through that commit and a normal useEffect here would never fire
  // again once the canvas actually shows up, leaving the QR blank. A
  // callback ref stored in state re-renders (and re-runs the draw effect)
  // exactly when the canvas node attaches, however late that is.
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const setCanvasRef = useCallback((node: HTMLCanvasElement | null) => {
    canvasRef.current = node;
    setCanvasEl(node);
  }, []);

  const joinUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?code=${encodeURIComponent(assessment.code)}`
      : '';

  useEffect(() => {
    if (canvasEl && joinUrl) {
      QRCode.toCanvas(canvasEl, joinUrl, {
        width: 200,
        margin: 1,
        color: { dark: '#24473A', light: '#ffffff' },
      });
    }
  }, [canvasEl, joinUrl]);

  function copyLink() {
    navigator.clipboard
      ?.writeText(joinUrl)
      .then(() => showToast('Join link copied.'))
      .catch(() => showToast(joinUrl));
  }

  function downloadQr() {
    const canvas = canvasRef.current;
    if (!canvas) {
      showToast('QR not ready yet, try again.');
      return;
    }
    const link = document.createElement('a');
    link.download = `${assessment.code}-qr.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  return (
    <Portal>
      <div
        className="modal-bg"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="modal">
          <button className="modal-close" onClick={onClose}>
            &#10005;
          </button>
          <h2>Registration — {assessment.title}</h2>
          <div className="qr-modal-body">
            <div className="access-code-big">{assessment.code}</div>
            <div id="qrcode-render">
              <canvas ref={setCanvasRef} />
            </div>
            <p className="subtle-note">
              Participants can scan this QR code, or visit the site and enter the access code above.
              They&apos;ll need a Gmail, Philippine government (.gov.ph), or school (.educ.ph / .education.ph) email address to register.
            </p>
            <div className="modal-actions" style={{ justifyContent: 'center' }}>
              <button className="btn btn-ghost btn-sm" onClick={downloadQr}>
                Download QR (PNG)
              </button>
              <button className="btn btn-ghost btn-sm" onClick={copyLink}>
                Copy join link
              </button>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}
