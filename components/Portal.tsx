'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// .wrap (see globals.css) is the app's scroll container so the page can be
// "locked" to the screen on mobile instead of the whole document scrolling.
// That means anything with `position:fixed` rendered *inside* .wrap — a
// modal backdrop, a toast, the answer-correct/-incorrect flash card — is no
// longer fixed to the real viewport on a lot of mobile browsers (notably
// iOS Safari): nested inside a scrolling ancestor, "fixed" elements can end
// up clipped, mispositioned, or simply not repaint/animate at all.
//
// This portal renders its children as a direct child of <body>, sidestepping
// that entirely so fixed overlays behave the same on phones as on desktop.
export default function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) return null; // document.body isn't available during SSR
  return createPortal(children, document.body);
}
