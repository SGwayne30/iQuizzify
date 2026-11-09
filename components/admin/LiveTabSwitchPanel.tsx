'use client';
import type { TabSwitchEvent } from '@/lib/types';

interface Props {
  /** Every respondent currently mid-quiz who has switched tabs at least once, across all assessments — updated live via polling in AdminApp. */
  events: TabSwitchEvent[];
  /** Opens the warn/block dialog for one flagged respondent. */
  onSelect: (event: TabSwitchEvent) => void;
}

/**
 * Floating panel: stays visible over the dashboard (any nav tab) whenever at
 * least one respondent currently taking an assessment has switched away
 * from the tab/window. One card per assessment that currently has alerts,
 * titled with that assessment's own name — a card appears the moment its
 * assessment gets its first live alert, and disappears once that
 * assessment's alerts are all cleared (every flagged respondent submitted).
 *
 * Each row is a button: clicking it opens the dialog where the admin can
 * warn that student or block them out of the assessment.
 */
function timeAgo(iso: string): string {
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 10) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

export default function LiveTabSwitchPanel({ events, onSelect }: Props) {
  if (events.length === 0) return null;

  const byAssessment = new Map<string, { title: string; events: TabSwitchEvent[] }>();
  for (const e of events) {
    const group = byAssessment.get(e.assessmentId);
    if (group) group.events.push(e);
    else byAssessment.set(e.assessmentId, { title: e.assessmentTitle, events: [e] });
  }

  const groups = [...byAssessment.entries()]
    .map(([assessmentId, g]) => ({
      assessmentId,
      title: g.title,
      events: [...g.events].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    }))
    .sort((a, b) => new Date(b.events[0]?.updatedAt ?? 0).getTime() - new Date(a.events[0]?.updatedAt ?? 0).getTime());

  return (
    <div className="live-alerts-stack">
      {groups.map((g) => (
        <div className="live-alerts-panel" key={g.assessmentId}>
          <div className="live-alerts-panel-head">{g.title}</div>
          <div className="live-alerts-panel-body">
            {g.events.map((e) => {
              const status = e.status ?? 'ok';
              const label = e.fullName ? `${e.fullName} (${e.email})` : e.email;
              return (
                <button
                  type="button"
                  className={`live-alert-row is-${status}`}
                  key={`${e.assessmentId}::${e.email}`}
                  onClick={() => onSelect(e)}
                  title="Warn or block this student"
                >
                  <span className="live-alert-icon">
                    {status === 'blocked' ? '\u26D4' : status === 'warned' ? '\u26A0\uFE0F' : '\u26A0\uFE0F'}
                  </span>
                  <span className="live-alert-body">
                    <span className="live-alert-text">
                      {label} switched away from the quiz ({e.count} total) · last {timeAgo(e.updatedAt)}
                    </span>
                    {status !== 'ok' && (
                      <span className={`live-alert-status is-${status}`}>
                        {status === 'blocked'
                          ? 'Blocked'
                          : `Warned${e.warnings && e.warnings > 1 ? ` \u00D7${e.warnings}` : ''}`}
                      </span>
                    )}
                  </span>
                  <span className="live-alert-chevron" aria-hidden="true">
                    &#9656;
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
