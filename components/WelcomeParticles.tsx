// Quiz symbols that drift up behind the welcome screens. Fixed positions (not random) so the
// server-rendered HTML matches the browser's first render.
const PARTICLES = [
  { g: '?', x: 4, s: 30, d: 0.2, t: 16 },
  { g: '✓', x: 11, s: 22, d: 3, t: 13 },
  { g: '★', x: 19, s: 20, d: 6, t: 15 },
  { g: '+', x: 27, s: 26, d: 1.2, t: 18 },
  { g: '?', x: 36, s: 20, d: 7.5, t: 14 },
  { g: '✓', x: 45, s: 28, d: 2.4, t: 17 },
  { g: '●', x: 53, s: 14, d: 5, t: 12 },
  { g: '★', x: 61, s: 24, d: 9, t: 16 },
  { g: '?', x: 69, s: 32, d: 4, t: 19 },
  { g: '+', x: 77, s: 20, d: 0.8, t: 13 },
  { g: '✓', x: 85, s: 24, d: 6.5, t: 15 },
  { g: '●', x: 92, s: 16, d: 2, t: 14 },
  { g: '★', x: 97, s: 18, d: 8, t: 17 },
];

export default function WelcomeParticles() {
  return (
    <div className="wf-particles" aria-hidden="true">
      {PARTICLES.map((p, i) => (
        <span key={i} style={{ left: `${p.x}%`, fontSize: p.s, animationDuration: `${p.t}s`, animationDelay: `${p.d}s` }}>
          {p.g}
        </span>
      ))}
    </div>
  );
}
