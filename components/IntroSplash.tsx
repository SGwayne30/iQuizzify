'use client';
import { useEffect, useState } from 'react';

const SEEN_KEY = 'iquizify_intro';

export default function IntroSplash() {
  const [phase, setPhase] = useState<'show' | 'leave' | 'gone'>('show');

  useEffect(() => {
    let seen = false;
    try {
      seen = !!sessionStorage.getItem(SEEN_KEY);
    } catch {}
    if (seen) {
      setPhase('gone');
      return;
    }
    const reduce = false;
    const t1 = window.setTimeout(() => {
      try {
        sessionStorage.setItem(SEEN_KEY, '1');
      } catch {}
      setPhase('leave');
    }, reduce ? 200 : 1500);
    const t2 = window.setTimeout(() => setPhase('gone'), reduce ? 400 : 2100);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  if (phase === 'gone') return null;

  return (
    <div className={`intro-splash${phase === 'leave' ? ' leaving' : ''}`} aria-hidden="true">
      <img src="/logo.png" alt="" className="intro-logo" />
      <div className="intro-title">iQuizify</div>
      <div className="intro-sub">Quizzes &amp; assessments for your classroom</div>
      <div className="intro-bar" />
    </div>
  );
}
