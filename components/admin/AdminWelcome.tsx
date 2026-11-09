'use client';
import { useState } from 'react';
import WelcomeBrand from '@/components/WelcomeBrand';
import WelcomeParticles from '@/components/WelcomeParticles';

// Welcome splash for the teacher dashboard. Shares the participant welcome
// screen's look (.welcome-* CSS) with teacher wording and a dashboard preview.
const BARS = [
  { label: 'BSIT', value: 86 },
  { label: 'BSCS', value: 74 },
  { label: 'BSEd', value: 91 },
  { label: 'BSBA', value: 68 },
];

export default function AdminWelcome({ onEnter }: { onEnter: () => void }) {
  const [leaving, setLeaving] = useState(false);

  function enter() {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(onEnter, 500);
  }

  return (
    <section className={`view welcome-view admin-welcome${leaving ? ' welcome-leaving' : ''}`}>
      <div className="welcome-screen">
        <div className="welcome-blob wb-1" aria-hidden="true" />
        <div className="welcome-blob wb-2" aria-hidden="true" />
        <WelcomeParticles />
        <div className="welcome-grid">
          <div className="welcome-content">
            <WelcomeBrand />
            <p className="welcome-tagline">Teacher dashboard</p>
            <h2 className="welcome-headline" aria-label="Create quizzes. Understand every student.">
              {'Create quizzes. Understand every student.'.split(' ').map((w, i) => (
                <span key={i} className="wh-word" aria-hidden="true" style={{ '--i': i } as React.CSSProperties}>
                  {w}{' '}
                </span>
              ))}
            </h2>
            <p className="welcome-lead">
              Build or import a quiz, share the code, and watch results come in live. Grade automatically,
              compare courses and subjects, and export clean reports to Excel or PDF.
            </p>
            <div className="welcome-actions">
              <button className="welcome-btn" onClick={enter}>
                Sign in to dashboard <span className="wb-arrow" aria-hidden="true">&#8594;</span>
              </button>
            </div>
            <ul className="welcome-chips">
              <li><i />Auto-grading</li>
              <li><i />Live monitoring</li>
              <li><i />Excel &amp; PDF reports</li>
            </ul>
          </div>

          <div className="welcome-preview" aria-hidden="true">
            <div className="wp-card wd-card">
              <div className="wp-head">
                <span className="wp-tag">Live results</span>
                <span className="wp-code">
                  <span className="wd-live" /> 3 taking now
                </span>
              </div>
              <div className="wd-stats">
                <div>
                  <b>367</b>
                  <span>Responses</span>
                </div>
                <div>
                  <b>78%</b>
                  <span>Class average</span>
                </div>
                <div>
                  <b>94%</b>
                  <span>Completed</span>
                </div>
              </div>
              <div className="wd-chart">
                <div className="wd-chart-title">Average score by course</div>
                {BARS.map((b, i) => (
                  <div className="wd-row" key={b.label}>
                    <span>{b.label}</span>
                    <div className="wd-track">
                      <i style={{ ['--w' as string]: `${b.value}%`, animationDelay: `${4.6 + i * 0.18}s` } as React.CSSProperties} />
                    </div>
                    <b>{b.value}%</b>
                  </div>
                ))}
              </div>
            </div>
            <div className="wp-float wp-float-a">Excel ready</div>
            <div className="wp-float wp-float-b">New response</div>
          </div>
        </div>
      </div>
    </section>
  );
}
