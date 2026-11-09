import { useId } from 'react';

// 4-point concave star centred on (cx, cy).
function star(cx: number, cy: number, rx: number, ry: number) {
  return `M${cx} ${cy - ry}Q${cx} ${cy} ${cx + rx} ${cy}Q${cx} ${cy} ${cx} ${cy + ry}Q${cx} ${cy} ${cx - rx} ${cy}Q${cx} ${cy} ${cx} ${cy - ry}Z`;
}

const BUBBLE_OUTER = 'M330 480 L262 600 L440 548 Z';
const BUBBLE_INNER = 'M345 470 L296 568 L410 524 Z';

export default function WelcomeLogo({ className, animated }: { className?: string; animated?: boolean }) {
  const uid = useId().replace(/:/g, '');
  const id = (n: string) => `${n}-${uid}`;
  return (
    <svg
      className={`${className ?? ''}${animated ? ' wl-anim' : ''}`}
      viewBox="20 20 720 740"
      role="img"
      aria-label="iQuizify logo"
    >
      <defs>
        <linearGradient id={id('tri')} gradientUnits="userSpaceOnUse" x1="120" y1="120" x2="330" y2="745">
          <stop offset="0" stopColor="#6eab97" />
          <stop offset="0.5" stopColor="#4f8a77" />
          <stop offset="0.8" stopColor="#3b7163" />
          <stop offset="1" stopColor="#2b564c" />
        </linearGradient>
        <linearGradient id={id('ring')} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#97d6b8" />
          <stop offset="0.45" stopColor="#5a9b85" />
          <stop offset="1" stopColor="#2b5a4f" />
        </linearGradient>
        <linearGradient id={id('inner')} gradientUnits="userSpaceOnUse" x1="400" y1="230" x2="520" y2="520">
          <stop offset="0" stopColor="#78b99f" />
          <stop offset="0.5" stopColor="#4f8d79" />
          <stop offset="0.62" stopColor="#37705f" />
          <stop offset="1" stopColor="#2f6256" />
        </linearGradient>
        {/* the white gap the bubble cuts out of the play triangle */}
        <mask id={id('gap')} maskUnits="userSpaceOnUse" x="0" y="0" width="780" height="800">
          <rect width="780" height="800" fill="#fff" />
          <circle cx="472" cy="338" r="288" fill="#000" />
          <path d={BUBBLE_OUTER} fill="#000" stroke="#000" strokeWidth="64" strokeLinejoin="round" />
        </mask>
        {/* bubble ring: outer disc + tail, minus the inner hole */}
        <mask id={id('ringMask')} maskUnits="userSpaceOnUse" x="0" y="0" width="780" height="800">
          <circle cx="472" cy="338" r="247" fill="#fff" />
          <path d={BUBBLE_OUTER} fill="#fff" stroke="#fff" strokeWidth="14" strokeLinejoin="round" />
          <circle cx="472" cy="338" r="203" fill="#000" />
          <path d={BUBBLE_INNER} fill="#000" stroke="#000" strokeWidth="10" strokeLinejoin="round" />
        </mask>
        <clipPath id={id('hole')}>
          <circle cx="472" cy="338" r="172" />
          <path d="M352 482 L316 556 L408 520 Z" />
        </clipPath>
      </defs>

      <g className="wl-tri">
        <g mask={`url(#${id('gap')})`}>
          <polygon
            points="70,70 70,715 690,380"
            fill={`url(#${id('tri')})`}
            stroke={`url(#${id('tri')})`}
            strokeWidth="60"
            strokeLinejoin="round"
          />
        </g>
      </g>

      <g className="wl-bubble">
        <rect width="780" height="800" fill={`url(#${id('ring')})`} mask={`url(#${id('ringMask')})`} />
        <g clipPath={`url(#${id('hole')})`}>
          <polygon
            points="360,205 612,382 322,548"
            fill={`url(#${id('inner')})`}
            stroke={`url(#${id('inner')})`}
            strokeWidth="46"
            strokeLinejoin="round"
          />
        </g>
        <path className="wl-star" d={star(375, 352, 92, 90)} fill="#2f5d52" />
      </g>
      <path className="wl-spark" d={star(545, 240, 45, 48)} fill="#6ab399" />
    </svg>
  );
}
