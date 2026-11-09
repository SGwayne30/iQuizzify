'use client';

import { useEffect, useRef } from 'react';

/**
 * DICT wordmark for the welcome screens. It keeps the traced D-i-C-T letters (each
 * letter still a `.wm-l` group so the existing intro sequence can animate them) and
 * adds a loop: DICT shows for 5s, breaks apart into "Department of Information and
 * Communications Technology", which shows for 5s, then breaks apart back into DICT.
 */

const LETTERS: string[][] = [["M597 319 L533 324 L530 344 L523 369 L513 390 L502 405 L491 415 L469 427 L455 431 L426 435 L67 436 L66 356 L1 359 L1 488 L418 488 L451 485 L483 479 L505 472 L529 460 L544 449 L564 427 L580 398 L587 378 L593 352Z", "M66 238 L1 251 L1 333 L66 329Z", "M591 129 L528 142 L532 160 L535 189 L535 297 L599 292 L600 202 L597 164Z", "M1 224 L63 212 L66 210 L67 58 L433 58 L467 64 L491 76 L508 93 L521 117 L584 104 L584 101 L576 81 L560 56 L540 37 L524 27 L508 20 L463 9 L420 5 L1 5Z"], ["M734 308 L669 314 L669 488 L734 488Z", "M734 99 L669 113 L670 287 L734 282Z", "M669 5 L669 85 L671 86 L734 73 L734 5Z"], ["M807 302 L808 346 L812 378 L821 411 L833 435 L841 446 L856 461 L869 470 L889 480 L921 489 L952 493 L1261 493 L1295 489 L1331 479 L1347 471 L1361 461 L1378 440 L1386 421 L1390 403 L1393 376 L1393 327 L1332 327 L1332 371 L1326 400 L1320 411 L1311 421 L1304 426 L1283 435 L1236 441 L973 441 L948 438 L926 432 L912 425 L895 411 L885 397 L876 375 L873 359 L872 296Z", "M807 275 L872 270 L872 145 L876 118 L885 96 L896 81 L906 72 L926 61 L948 55 L975 52 L1233 52 L1272 56 L1285 60 L1301 69 L1316 86 L1321 96 L1326 114 L1328 161 L1384 161 L1384 104 L1382 90 L1375 66 L1360 42 L1339 24 L1304 8 L1269 1 L954 0 L927 3 L892 12 L876 19 L860 29 L842 46 L830 63 L817 94 L811 121 L807 164Z"], ["M1733 190 L1668 198 L1668 488 L1733 488Z", "M1422 5 L1422 58 L1667 58 L1668 172 L1733 163 L1734 58 L1979 57 L1979 5Z"]];

const LINES = ['DEPARTMENT OF INFORMATION AND', 'COMMUNICATIONS TECHNOLOGY'];
const FULL_NAME = 'Department of Information and Communications Technology';

const HOLD_MS = 5000; // how long each version stays on screen
const BREAK_MS = 1000; // how long a break-apart / re-form takes
const HOME = 'translate(0px, 0px) rotate(0deg) scale(1)';

// Fixed pseudo-random numbers so every play looks the same.
function rnd(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

/** Starts an animation, then writes its end state to the inline style and drops the animation. */
function animateTo(el: HTMLElement | SVGElement, from: Keyframe, to: Keyframe, opts: KeyframeAnimationOptions) {
  const anim = el.animate([from, to], { fill: 'both', ...opts });
  anim.finished
    .then(() => {
      Object.assign((el as HTMLElement).style, to);
      anim.cancel();
    })
    .catch(() => {});
  return anim;
}

export default function DictWordmark({ startAfter = 4500 }: { startAfter?: number }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const nameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    const name = nameRef.current;
    if (!svg || !name || typeof svg.animate !== 'function') return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const mv = reduced ? 0 : 1; // reduced motion: cross-fade only, no flying pieces
    const pieces = Array.from(svg.querySelectorAll<SVGPathElement>('.wm-piece'));
    const chars = Array.from(name.querySelectorAll<HTMLElement>('.fn-c'));
    const timers: number[] = [];
    const anims: Animation[] = [];
    const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms));
    const keep = (a: Animation) => {
      anims.push(a);
      return a;
    };

    const scatter = (seed: number, spread: number, scale: number) => {
      const dx = (rnd(seed) - 0.5) * 2 * spread * mv;
      const dy = (rnd(seed + 1) - 0.5) * 2 * spread * mv;
      const rot = (rnd(seed + 2) - 0.5) * 70 * mv;
      const sc = mv ? scale : 1;
      return `translate(${dx}px, ${dy}px) rotate(${rot}deg) scale(${sc})`;
    };

    // DICT -> full name: the letter pieces fly apart, then the name's letters gather.
    const toName = () => {
      pieces.forEach((p, i) => {
        keep(
          animateTo(
            p,
            { opacity: 1, transform: HOME },
            { opacity: 0, transform: scatter(i * 7 + 1, 380, 0.4) },
            { duration: BREAK_MS * 0.7, delay: i * 35, easing: 'cubic-bezier(.55,0,.9,.4)' }
          )
        );
      });
      chars.forEach((c, i) => {
        keep(
          animateTo(
            c,
            { opacity: 0, transform: scatter(i * 5 + 3, 26, 0.3) },
            { opacity: 1, transform: HOME },
            { duration: BREAK_MS * 0.75, delay: BREAK_MS * 0.3 + i * 9, easing: 'cubic-bezier(.16,1,.3,1)' }
          )
        );
      });
    };

    // Full name -> DICT: the name's letters scatter, then the DICT pieces come back together.
    const toDict = () => {
      chars.forEach((c, i) => {
        keep(
          animateTo(
            c,
            { opacity: 1, transform: HOME },
            { opacity: 0, transform: scatter(i * 5 + 11, 26, 0.3) },
            { duration: BREAK_MS * 0.6, delay: i * 8, easing: 'cubic-bezier(.55,0,.9,.4)' }
          )
        );
      });
      pieces.forEach((p, i) => {
        keep(
          animateTo(
            p,
            { opacity: 0, transform: scatter(i * 7 + 5, 380, 0.4) },
            { opacity: 1, transform: HOME },
            { duration: BREAK_MS * 0.8, delay: BREAK_MS * 0.4 + i * 35, easing: 'cubic-bezier(.16,1,.3,1)' }
          )
        );
      });
    };

    const toNameMs = BREAK_MS * 1.3 + chars.length * 9;
    const toDictMs = BREAK_MS * 1.3 + pieces.length * 35 + 50;
    const cycle = () => {
      later(() => {
        toName();
        later(() => {
          toDict();
          later(cycle, toDictMs);
        }, toNameMs + HOLD_MS);
      }, HOLD_MS);
    };
    later(cycle, startAfter);

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      anims.forEach((a) => a.cancel());
    };
  }, [startAfter]);

  let charIndex = 0;
  return (
    <>
      <svg ref={svgRef} className="welcome-wordmark" viewBox="0 0 1981 494" role="img" aria-label={`DICT, ${FULL_NAME}`}>
        {/* Official DICT wordmark, traced from the standard sub-brand logo. Each stroke segment is its own piece so it can break apart. */}
        {LETTERS.map((segments, li) => (
          <g className="wm-l" key={li}>
            {segments.map((d, pi) => (
              <path className="wm-piece" key={pi} style={{ fill: '#2A765B', stroke: 'none' }} fillRule="evenodd" d={d} />
            ))}
          </g>
        ))}
      </svg>
      <div ref={nameRef} className="welcome-fullname" aria-hidden="true">
        {LINES.map((line) => (
          <div className="fn-line" key={line}>
            {line.split(' ').map((word, wi) => (
              <span className="fn-word" key={wi}>
                {Array.from(word).map((ch) => (
                  <span className="fn-c" key={charIndex++}>
                    {ch}
                  </span>
                ))}
              </span>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
