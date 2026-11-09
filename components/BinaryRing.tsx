'use client';
import { useEffect, useRef } from 'react';

// Glyph layout measured from /logo-ring.png (700x700): [x, y, rotation, char].
// The 32 bits spell D-I-C-T in ASCII (01000100 01001001 01000011 01010100),
// listed clockwise starting at the "D" on the left.
const BITS: [number, number, number, string][] = [
  [147, 593, 219.9, '0'], [113, 564, 227.9, '1'], [89, 530, 235.5, '0'], [67, 493, 243.2, '0'],
  [50, 454, 250.9, '0'], [36, 410, 259.1, '1'], [33, 369, 266.5, '0'], [32, 326, -85.8, '0'],
  [59, 219, -65.8, '0'], [78, 179, -57.9, '1'], [104, 146, -50.4, '0'], [134, 115, -42.6, '0'],
  [167, 85, -34.7, '1'], [204, 65, -27.2, '0'], [243, 48, -19.5, '0'], [285, 34, -11.6, '1'],
  [417, 37, 12.1, '0'], [460, 47, 20.0, '1'], [498, 66, 27.5, '0'], [534, 88, 35.1, '0'],
  [567, 116, 42.8, '0'], [596, 147, 50.5, '0'], [624, 182, 58.5, '1'], [644, 221, 66.2, '1'],
  [667, 328, 86.0, '0'], [669, 372, 94.0, '1'], [661, 413, 101.5, '0'], [651, 457, 109.6, '1'],
  [632, 494, 117.0, '0'], [611, 534, 125.2, '1'], [583, 564, 132.6, '0'], [551, 593, 140.4, '0'],
];
const YEAR: [number, number, number, string][] = [
  [301, 659, 9.0, '2'], [333, 661, 3.1, '0'], [367, 659, -3.2, '1'], [399, 659, -9.1, '6'],
];
const DOTS: [number, number][] = [[218, 638], [480, 638]];

const GLYPHS = [...BITS, ...YEAR];
const FADE_IN = 380; // glyphs fade in showing random bits
const SCRAMBLE = 750; // first bit locks after this long
const LOCK_STEP = 38; // then one glyph locks in every 38ms, clockwise
const TICK = 62; // how often the random characters change
const YEAR_AT = SCRAMBLE + BITS.length * LOCK_STEP + 60;
const YEAR_STEP = 120;
const END_AT = YEAR_AT + YEAR.length * YEAR_STEP + 250; // then cross-fade to the real PNG

function lockTime(i: number) {
  return i < BITS.length ? SCRAMBLE + i * LOCK_STEP : YEAR_AT + (i - BITS.length) * YEAR_STEP;
}

/**
 * The binary ring of the logo. The glyphs first flicker with random 0/1 (and
 * random digits for "2016"), then lock in one by one, clockwise, into the real
 * binary code. When done, it cross-fades to the exact logo-ring.png artwork.
 * `startAt` = ms after mount when the animation begins.
 * Driven by JS (rAF) and deliberately ignores prefers-reduced-motion: phones
 * report it in Low Power / battery-saver mode, which used to skip the animation.
 */
export default function BinaryRing({ startAt }: { startAt: number }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    const img = imgRef.current;
    if (!svg || !img) return;
    const texts = Array.from(svg.querySelectorAll<SVGTextElement>('.br-g'));
    const dots = Array.from(svg.querySelectorAll<SVGCircleElement>('.br-dot'));
    let raf = 0;
    const done = new Array(texts.length).fill(false);
    const lastTick = new Array(texts.length).fill(-1);
    let finished = false;

    const showFinal = () => {
      finished = true;
      img.style.transition = 'opacity .35s ease';
      img.style.opacity = '1';
      svg.style.transition = 'opacity .35s ease';
      svg.style.opacity = '0';
    };

    const t0 = performance.now() + startAt;
    const frame = (now: number) => {
      const t = now - t0;
      if (t >= 0 && !finished) {
        texts.forEach((el, i) => {
          if (done[i]) return;
          const isBit = i < BITS.length;
          const start = i * 8; // slight stagger on the way in
          el.style.opacity = String(Math.min(1, Math.max(0, (t - start) / FADE_IN)));
          if (t >= lockTime(i)) {
            done[i] = true;
            el.textContent = GLYPHS[i][3];
            el.classList.add('br-locked');
            return;
          }
          const slot = Math.floor((t + i * 17) / TICK);
          if (slot !== lastTick[i]) {
            lastTick[i] = slot;
            el.textContent = isBit ? (Math.random() < 0.5 ? '0' : '1') : String(Math.floor(Math.random() * 10));
          }
        });
        dots.forEach((d, i) => {
          const p = Math.min(1, Math.max(0, (t - (YEAR_AT + i * 80)) / 300));
          d.style.opacity = String(p);
          d.style.transform = `scale(${0.3 + 0.7 * p})`;
        });
        if (t >= END_AT) showFinal();
      }
      if (!finished) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      img.style.opacity = '';
      img.style.transition = '';
      svg.style.opacity = '';
      svg.style.transition = '';
      texts.forEach((el, i) => {
        el.style.opacity = '';
        el.classList.remove('br-locked');
        el.textContent = GLYPHS[i][3];
      });
      dots.forEach((d) => {
        d.style.opacity = '';
        d.style.transform = '';
      });
    };
  }, [startAt]);

  return (
    <>
      <img ref={imgRef} className="welcome-logo-ring" src="/logo-ring.png" alt="" aria-hidden="true" />
      <svg ref={svgRef} className="welcome-ring-code" viewBox="0 0 700 700" aria-hidden="true">
        {GLYPHS.map(([x, y, r, c], i) => (
          <text key={i} className="br-g" transform={`translate(${x} ${y}) rotate(${r})`} textAnchor="middle" dy=".357em">
            {c}
          </text>
        ))}
        {DOTS.map(([x, y], i) => (
          <circle key={i} className="br-dot" cx={x} cy={y} r="9.5" />
        ))}
      </svg>
    </>
  );
}