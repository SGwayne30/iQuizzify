'use client';
import { useEffect, useRef } from 'react';
import WelcomeLogo from '@/components/participant/WelcomeLogo';

/**
 * Animated logo + "iQuizify" wordmark used on the welcome screens. The sun
 * above the dotless "ı" is centred on the real stem of the glyph: its ink box
 * is measured in the loaded font and exposed as CSS variables, so it lines up
 * at any size.
 */
export default function WelcomeBrand() {
  const h1Ref = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let cancelled = false;
    function align() {
      const h1 = h1Ref.current;
      const ctx = document.createElement('canvas').getContext('2d');
      if (!h1 || !ctx || cancelled) return;
      const cs = getComputedStyle(h1);
      const size = parseFloat(cs.fontSize);
      ctx.font = `${cs.fontWeight} ${size}px ${cs.fontFamily}`;
      const m = ctx.measureText('ı');
      const inkCenter = (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
      const ix = (inkCenter - m.width / 2) / size;
      const fa = m.fontBoundingBoxAscent ?? size * 0.8;
      const fd = m.fontBoundingBoxDescent ?? size * 0.2;
      const baselineFromBottom = (size - (fa + fd)) / 2 + fd;
      const stemTop = baselineFromBottom + m.actualBoundingBoxAscent;
      h1.style.setProperty('--ix', `${ix}em`);
      h1.style.setProperty('--ib', `${(stemTop + size * 0.14) / size - 0.108}em`);
    }
    document.fonts.ready.then(align);
    window.addEventListener('resize', align);
    return () => {
      cancelled = true;
      window.removeEventListener('resize', align);
    };
  }, []);

  return (
    <div className="welcome-brand">
      <WelcomeLogo className="welcome-logo" animated />
      <div className="welcome-wordmark-text">
        <h1 ref={h1Ref} aria-label="iQuizify">
          {Array.from('ıQuizify').map((ch, i) => (
            <span key={i} className="wl-letter" style={{ '--i': i } as React.CSSProperties} aria-hidden="true">
              {i === 0 && (
                <svg className="welcome-rays" viewBox="0 0 60 36" aria-hidden="true">
                  <g className="wr-rays" stroke="#7fcfae" strokeWidth="2.6" strokeLinecap="round">
                    <line x1="30" y1="2" x2="30" y2="7" />
                    <line x1="13" y1="8" x2="17" y2="12" />
                    <line x1="47" y1="8" x2="43" y2="12" />
                    <line x1="4" y1="22" x2="9" y2="22" />
                    <line x1="56" y1="22" x2="51" y2="22" />
                  </g>
                  <circle className="wr-sun" cx="30" cy="23" r="6.5" fill="#8fdcb8" />
                </svg>
              )}
              {ch}
            </span>
          ))}
        </h1>
      </div>
    </div>
  );
}
