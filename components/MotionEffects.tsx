'use client';

import { useEffect } from 'react';

// Admin-side motion. Everything here uses the Web Animations API (instead of
// CSS keyframes) so the global prefers-reduced-motion override in globals.css
// can't flatten it, and a single MutationObserver covers every screen and
// modal without having to touch each component.

const EASE = 'cubic-bezier(.16,1,.3,1)';
const isAdminPage = () => typeof window !== 'undefined' && window.location.pathname.startsWith('/admin');

function riseIn(el: Element, opts: { dist?: number; duration?: number; delay?: number } = {}) {
  const { dist = 14, duration = 420, delay = 0 } = opts;
  el.animate(
    [
      { opacity: 0, transform: `translateY(${dist}px)` },
      { opacity: 1, transform: 'translateY(0)' },
    ],
    { duration, delay, easing: EASE, fill: 'backwards' }
  );
}

function stagger(els: Element[], opts: { dist?: number; duration?: number; start?: number; step?: number; max?: number } = {}) {
  const { start = 0, step = 55, max = 14, ...rest } = opts;
  els.slice(0, max).forEach((el, i) => riseIn(el, { ...rest, delay: start + i * step }));
}

function playModal(bg: Element) {
  if (bg.classList.contains('disclaimer-bg')) return; // participant modal animates itself
  bg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
  bg.querySelector('.modal')?.animate(
    [
      { opacity: 0, transform: 'translateY(26px) scale(0.94)' },
      { opacity: 1, transform: 'translateY(-3px) scale(1.01)', offset: 0.7 },
      { opacity: 1, transform: 'translateY(0) scale(1)' },
    ],
    { duration: 440, easing: EASE, fill: 'backwards' }
  );
}

function playShell(shell: Element) {
  shell.querySelector('.admin-nav')?.animate(
    [
      { opacity: 0, transform: 'translateX(-28px)' },
      { opacity: 1, transform: 'translateX(0)' },
    ],
    { duration: 520, easing: EASE, fill: 'backwards' }
  );
  shell.querySelectorAll('.admin-nav-tabs button').forEach((el, i) => {
    el.animate(
      [
        { opacity: 0, transform: 'translateX(-16px)' },
        { opacity: 1, transform: 'translateX(0)' },
      ],
      { duration: 420, delay: 180 + i * 70, easing: EASE, fill: 'backwards' }
    );
  });
}

function playTab(panel: Element) {
  const root = panel.firstElementChild;
  if (!root || root.classList.contains('analytics-page')) return; // Analytics animates itself
  stagger(
    Array.from(root.children).filter((c) => !c.classList.contains('cards-grid')),
    { start: 60 }
  );
  stagger(Array.from(panel.querySelectorAll('.cards-grid > *')), { start: 200, step: 45, dist: 18, duration: 400, max: 12 });
  stagger(Array.from(panel.querySelectorAll('table.data-table tbody tr')), { start: 220, step: 28, dist: 8, duration: 300, max: 14 });
}

function playToast(toast: Element) {
  // .toast is centred with translateX(-50%), so keep that in every keyframe.
  toast.animate(
    [
      { opacity: 0, transform: 'translateX(-50%) translateY(22px) scale(0.96)' },
      { opacity: 1, transform: 'translateX(-50%) translateY(0) scale(1)' },
    ],
    { duration: 380, easing: EASE, fill: 'backwards' }
  );
}

export default function MotionEffects() {
  useEffect(() => {
    const seen = new WeakSet<Element>();

    function handle(el: Element) {
      if (seen.has(el)) return;
      seen.add(el);
      if (el.matches('.modal-bg')) playModal(el);
      else if (el.matches('.admin-shell')) playShell(el);
      else if (el.matches('.tab-panel')) playTab(el);
      else if (el.matches('.toast')) playToast(el);
    }

    const observer = new MutationObserver((mutations) => {
      if (!isAdminPage()) return;
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          handle(node);
          node.querySelectorAll('.modal-bg, .admin-shell, .tab-panel, .toast').forEach(handle);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Tap feedback on admin buttons and sidebar tabs.
    function onClick(e: MouseEvent) {
      if (!isAdminPage()) return;
      const target = (e.target as Element | null)?.closest('.btn, .admin-nav-tabs button, .sidebar-toggle-btn');
      if (!target || (target as HTMLButtonElement).disabled) return;
      target.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(0.94)' }, { transform: 'scale(1)' }],
        { duration: 230, easing: 'ease-out' }
      );
    }
    document.addEventListener('click', onClick);

    return () => {
      observer.disconnect();
      document.removeEventListener('click', onClick);
    };
  }, []);

  return null;
}