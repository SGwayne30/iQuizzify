'use client';

import { useEffect } from 'react';

/** Plays a subtle tap cue for enabled buttons throughout the app. */
export default function ButtonClickSound() {
  useEffect(() => {
    function playClick(event: MouseEvent) {
      const button = (event.target as Element | null)?.closest('button:not(:disabled)');
      if (!button) return;

      try {
        const audioWindow = window as Window & { webkitAudioContext?: typeof AudioContext };
        const AudioContextConstructor = window.AudioContext || audioWindow.webkitAudioContext;
        if (!AudioContextConstructor) return;

        const context = new AudioContextConstructor();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const now = context.currentTime;
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(740, now);
        oscillator.frequency.exponentialRampToValueAtTime(560, now + 0.045);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.045, now + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(now);
        oscillator.stop(now + 0.06);
        window.setTimeout(() => void context.close(), 150);
      } catch {
        // Audio is optional and must never prevent the button action.
      }
    }

    document.addEventListener('click', playClick);
    return () => document.removeEventListener('click', playClick);
  }, []);

  return null;
}
