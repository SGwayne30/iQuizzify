'use client';
import { useEffect, useState } from 'react';

// A tiny self-playing quiz for the welcome screen: shows a question, a student picks an answer,
// the answer is revealed (right or wrong), then the next question slides in.
const QUESTIONS = [
  { q: 'Which planet is known as the Red Planet?', options: ['Venus', 'Mars', 'Jupiter', 'Saturn'], correct: 1, pick: 1 },
  { q: 'What is 12 × 8?', options: ['86', '96', '108', '88'], correct: 1, pick: 3 },
  { q: 'Which language runs in every web browser?', options: ['Python', 'JavaScript', 'C#', 'Java'], correct: 1, pick: 1 },
];
const LETTERS = ['A', 'B', 'C', 'D'];

// Milliseconds after the question appears.
const PICK_AT = 1900;
const REVEAL_AT = 3300;
const NEXT_AT = 6200;

export default function WelcomePreview() {
  const [qi, setQi] = useState(0);
  const [step, setStep] = useState<0 | 1 | 2>(0); // 0 asking, 1 picked, 2 revealed
  const [score, setScore] = useState(0);
  const [joined, setJoined] = useState(24);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 });

  useEffect(() => {
    // The first question waits for the page's reveal sequence to finish.
    const lead = qi === 0 && score === 0 ? 3600 : 0;
    const t1 = window.setTimeout(() => setStep(1), lead + PICK_AT);
    const t2 = window.setTimeout(() => {
      setStep(2);
      if (QUESTIONS[qi].pick === QUESTIONS[qi].correct) setScore((s) => s + 10);
    }, lead + REVEAL_AT);
    const t3 = window.setTimeout(() => {
      setStep(0);
      setQi((i) => (i + 1) % QUESTIONS.length);
      setJoined((n) => (n >= 31 ? 24 : n + 1));
    }, lead + NEXT_AT);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qi]);

  const item = QUESTIONS[qi];
  const right = item.pick === item.correct;

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    setTilt({ rx: -y * 8, ry: x * 10 });
  }

  return (
    <div
      className="welcome-preview wv"
      aria-hidden="true"
      onMouseMove={onMove}
      onMouseLeave={() => setTilt({ rx: 0, ry: 0 })}
    >
      <div className="wv-tilt" style={{ transform: `perspective(1000px) rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)` }}>
        <div className="wp-card wv-card">
          <div className="wp-head">
            <span className="wp-tag">Live quiz</span>
            <span className="wp-code">
              Code <b>482 913</b>
            </span>
          </div>
          <div className="wv-timer">
            <span key={qi} style={{ animationDuration: `${NEXT_AT}ms` }} />
          </div>
          <div className="wv-stage" key={qi}>
            <div className="wv-q">{item.q}</div>
            <div className="wv-opts">
              {item.options.map((o, i) => {
                const picked = step >= 1 && i === item.pick;
                const isKey = step === 2 && i === item.correct;
                const isWrong = step === 2 && picked && !right;
                return (
                  <div
                    key={o}
                    className={`wv-opt${picked ? ' is-picked' : ''}${isKey ? ' is-right' : ''}${isWrong ? ' is-wrong' : ''}`}
                    style={{ animationDelay: `${i * 90}ms` }}
                  >
                    <b>{LETTERS[i]}</b>
                    <span>{o}</span>
                    {isKey && <i className="wv-mark ok">{'✓'}</i>}
                    {isWrong && <i className="wv-mark no">{'✕'}</i>}
                  </div>
                );
              })}
            </div>
            <div className={`wv-feedback${step === 2 ? (right ? ' is-ok' : ' is-no') : ''}`}>
              {step === 2 ? (right ? 'Correct! +10 pts' : 'Not quite — answer revealed') : ' '}
            </div>
          </div>
          <div className="wp-foot">
            <span className="wp-avatars">
              <i />
              <i />
              <i />
              <i />
            </span>
            <span>
              <b className="wv-count">{joined}</b> students joined
            </span>
          </div>
        </div>
      </div>
      <div className="wp-float wp-float-a">
        Score <b key={score}>{score}</b>
      </div>
      <div className="wp-float wp-float-b">Answer saved</div>
    </div>
  );
}
