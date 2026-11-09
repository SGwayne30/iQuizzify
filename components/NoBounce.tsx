'use client';

import { useEffect } from 'react';

/**
 * Stops the iOS rubber-band / pull-to-refresh drag on the main scroll container so
 * the sticky navbar never slides. Touches inside a nested scroller that can still
 * scroll (modals, wide tables, dropdowns) are left alone.
 */
export default function NoBounce() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.wrap');
    if (!root) return;

    let startY = 0;

    function canScroll(el: HTMLElement, dy: number) {
      const style = window.getComputedStyle(el);
      if (!/(auto|scroll)/.test(style.overflowY)) return false;
      if (el.scrollHeight <= el.clientHeight + 1) return false;
      // dy > 0 means the finger moves down, i.e. content scrolls toward the top.
      return dy > 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    }

    function onStart(e: TouchEvent) {
      startY = e.touches[0]?.clientY ?? 0;
    }

    function onMove(e: TouchEvent) {
      if (e.touches.length !== 1 || !e.cancelable) return; // ignore pinch-zoom
      const dy = e.touches[0].clientY - startY;
      if (dy === 0) return;
      let el = e.target as HTMLElement | null;
      while (el && el !== document.body) {
        if (canScroll(el, dy)) return; // something inside can still scroll: let it
        if (el === root) break;
        el = el.parentElement;
      }
      e.preventDefault(); // nothing can scroll that way: it would only bounce
    }

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
    };
  }, []);

  return null;
}
