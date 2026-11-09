'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Chart,
  ArcElement,
  BarElement,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  DoughnutController,
  BarController,
  LineController,
  type ChartConfiguration,
} from 'chart.js';
import type { Assessment, CustomField, DB, Question, ResponseRecord } from '@/lib/types';
import { exportPDF } from '@/lib/export';
import RespondentModal from './RespondentModal';
import ChartCanvas from './ChartCanvas';
import { CopyChartButton, ShareCard, StackedLevelCard, TopListCard } from './InsightCards';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

/** Number that counts smoothly up (or down) to the real value. Re-runs when the value or triggerKey changes. */
function RollingNumber({
  value,
  suffix = '',
  triggerKey,
  delay = 0,
}: {
  value: number;
  suffix?: string;
  triggerKey?: string | null;
  delay?: number;
}) {
  const target = Math.round(value);
  const [display, setDisplay] = useState(target);
  const shownRef = useRef(target);

  useEffect(() => {
    // Start from what's on screen now; if it already equals the target (same value
    // re-triggered), replay from 0 so the change is still visible.
    const from = shownRef.current === target ? 0 : shownRef.current;
    const reduced =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reduced ? 350 : 900;
    let raf = 0;
    let startAt = 0;
    const wait = reduced ? 0 : delay;

    function show(n: number) {
      shownRef.current = n;
      setDisplay(n);
    }

    function tick(now: number) {
      if (!startAt) startAt = now;
      const t = Math.min((now - startAt) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic: fast start, gentle landing
      show(Math.round(from + (target - from) * eased));
      if (t < 1) raf = window.requestAnimationFrame(tick);
      else show(target);
    }

    show(from);
    const timer = window.setTimeout(() => {
      raf = window.requestAnimationFrame(tick);
    }, wait);

    return () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(raf);
    };
  }, [target, triggerKey, delay]);

  return (
    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
      {display}
      {suffix}
    </span>
  );
}

/** Per-question answer-distribution bars, in the style of Google Forms' Summary tab. */
function QuestionBreakdown({ a, list }: { a: Assessment; list: ResponseRecord[] }) {
  let lastSectionId: string | undefined;

  function distributionFor(q: Question) {
    const counts = new Array(q.options.length).fill(0);
    let answered = 0;
    list.forEach((r) => {
      const ans = r.answers.find((x) => x.questionId === q.id);
      if (!ans) return;
      if (q.type === 'checkbox') {
        (ans.selectedIndexes || []).forEach((i) => {
          if (counts[i] !== undefined) counts[i]++;
        });
        if ((ans.selectedIndexes || []).length > 0) answered++;
      } else if (ans.selectedIndex >= 0) {
        counts[ans.selectedIndex] = (counts[ans.selectedIndex] || 0) + 1;
        answered++;
      }
    });
    return { counts, answered };
  }

  /** Distribution over 1..scaleMax numeric values, for linearScale / rating. */
  function scaleDistributionFor(q: Question) {
    const max = q.scaleMax || 5;
    const counts = new Array(max).fill(0);
    let answered = 0;
    let sum = 0;
    list.forEach((r) => {
      const ans = r.answers.find((x) => x.questionId === q.id);
      if (!ans || ans.selectedIndex < 1) return;
      counts[ans.selectedIndex - 1] = (counts[ans.selectedIndex - 1] || 0) + 1;
      sum += ans.selectedIndex;
      answered++;
    });
    return { counts, answered, avg: answered > 0 ? sum / answered : 0 };
  }

  /** Per-row/per-column tallies for mcqGrid / checkboxGrid. */
  function gridDistributionFor(q: Question) {
    const rows = q.rows || [];
    const perRow = rows.map(() => new Array(q.options.length).fill(0));
    const perRowAnswered = rows.map(() => 0);
    list.forEach((r) => {
      const ans = r.answers.find((x) => x.questionId === q.id);
      if (!ans) return;
      rows.forEach((_, ri) => {
        if (q.type === 'checkboxGrid') {
          const cis = ans.gridAnswersMulti?.[ri] || [];
          cis.forEach((ci) => {
            if (perRow[ri][ci] !== undefined) perRow[ri][ci]++;
          });
          if (cis.length) perRowAnswered[ri]++;
        } else {
          const ci = ans.gridAnswers?.[ri];
          if (ci !== undefined && perRow[ri][ci] !== undefined) {
            perRow[ri][ci]++;
            perRowAnswered[ri]++;
          }
        }
      });
    });
    return { perRow, perRowAnswered };
  }

  return (
    <>
      {a.questions.map((q, qi) => {
        const sec = a.sections?.find((s) => s.id === q.sectionId);
        const showSectionLabel = sec && sec.id !== lastSectionId;
        if (sec) lastSectionId = sec.id;

        if (q.type === 'paragraph' || q.type === 'shortAnswer') {
          const texts = list
            .map((r) => r.answers.find((x) => x.questionId === q.id)?.textAnswer)
            .filter((t): t is string => !!t && t.trim().length > 0);
          return (
            <div className="qbreak-card" key={q.id}>
              {showSectionLabel && <div className="qbreak-section">{sec!.title}</div>}
              <h4>
                Q{qi + 1}. {q.text}
              </h4>
              <div className="qbreak-meta">
                {q.type === 'shortAnswer' ? 'Short answer' : 'Paragraph'} &middot; {texts.length} response
                {texts.length === 1 ? '' : 's'}
              </div>
              {texts.length === 0 ? (
                <p className="subtle-note">No responses yet.</p>
              ) : (
                <div className="qbreak-answers-list">
                  {texts.map((t, i) => (
                    <div className="qbreak-answer-item" key={i}>
                      {t}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        }

        if (q.type === 'date' || q.type === 'time') {
          const values = list
            .map((r) => {
              const ans = r.answers.find((x) => x.questionId === q.id);
              return q.type === 'date' ? ans?.dateAnswer : ans?.timeAnswer;
            })
            .filter((v): v is string => !!v);
          return (
            <div className="qbreak-card" key={q.id}>
              {showSectionLabel && <div className="qbreak-section">{sec!.title}</div>}
              <h4>
                Q{qi + 1}. {q.text}
              </h4>
              <div className="qbreak-meta">
                {q.type === 'date' ? 'Date' : 'Time'} &middot; {values.length} response{values.length === 1 ? '' : 's'}
              </div>
              {values.length === 0 ? (
                <p className="subtle-note">No responses yet.</p>
              ) : (
                <div className="qbreak-answers-list">
                  {values.map((v, i) => (
                    <div className="qbreak-answer-item" key={i}>
                      {v}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        }

        if (q.type === 'fileUpload') {
          const files = list
            .map((r) => r.answers.find((x) => x.questionId === q.id)?.fileAnswer)
            .filter((f): f is NonNullable<typeof f> => !!f);
          return (
            <div className="qbreak-card" key={q.id}>
              {showSectionLabel && <div className="qbreak-section">{sec!.title}</div>}
              <h4>
                Q{qi + 1}. {q.text}
              </h4>
              <div className="qbreak-meta">File upload &middot; {files.length} response{files.length === 1 ? '' : 's'}</div>
              {files.length === 0 ? (
                <p className="subtle-note">No responses yet.</p>
              ) : (
                <div className="qbreak-answers-list">
                  {files.map((f, i) => (
                    <div className="qbreak-answer-item" key={i}>
                      <a href={f.dataUrl} download={f.name}>
                        {f.name}
                      </a>{' '}
                      &middot; {(f.size / 1024).toFixed(0)} KB
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        }

        if (q.type === 'linearScale' || q.type === 'rating') {
          const { counts, answered, avg } = scaleDistributionFor(q);
          const max = Math.max(1, ...counts);
          return (
            <div className="qbreak-card" key={q.id}>
              {showSectionLabel && <div className="qbreak-section">{sec!.title}</div>}
              <h4>
                Q{qi + 1}. {q.text}
              </h4>
              <div className="qbreak-meta">
                {q.type === 'rating' ? 'Rating' : 'Linear scale'} &middot; {answered} response{answered === 1 ? '' : 's'}
                {answered > 0 ? ` \u00b7 avg ${avg.toFixed(1)}` : ''}
              </div>
              {answered === 0 ? (
                <p className="subtle-note">No responses yet.</p>
              ) : (
                counts.map((c, ci) => {
                  const val = ci + 1;
                  const pct = Math.round((c / max) * 100);
                  return (
                    <div className="qbreak-bar-row" key={ci}>
                      <div className="qbreak-bar-label">
                        <span className="txt">{val}</span>
                        <span className="cnt">{c}</span>
                      </div>
                      <div className="qbreak-track">
                        <div className="qbreak-fill" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          );
        }

        if (q.type === 'mcqGrid' || q.type === 'checkboxGrid') {
          const { perRow, perRowAnswered } = gridDistributionFor(q);
          const rows = q.rows || [];
          return (
            <div className="qbreak-card" key={q.id}>
              {showSectionLabel && <div className="qbreak-section">{sec!.title}</div>}
              <h4>
                Q{qi + 1}. {q.text}
              </h4>
              <div className="qbreak-meta">{q.type === 'checkboxGrid' ? 'Checkbox grid' : 'Multiple choice grid'}</div>
              {rows.map((row, ri) => {
                const counts = perRow[ri];
                const max = Math.max(1, ...counts);
                const answered = perRowAnswered[ri];
                return (
                  <div key={ri} style={{ marginTop: 10 }}>
                    <div className="qbreak-meta" style={{ fontWeight: 600, color: 'var(--text)' }}>
                      {row} &middot; {answered} response{answered === 1 ? '' : 's'}
                    </div>
                    {answered === 0 ? (
                      <p className="subtle-note">No responses yet.</p>
                    ) : (
                      q.options.map((opt, ci) => {
                        const c = counts[ci] || 0;
                        const pct = Math.round((c / max) * 100);
                        return (
                          <div className="qbreak-bar-row" key={ci}>
                            <div className="qbreak-bar-label">
                              <span className="txt">{opt}</span>
                              <span className="cnt">{c}</span>
                            </div>
                            <div className="qbreak-track">
                              <div className="qbreak-fill" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                );
              })}
            </div>
          );
        }

        const { counts, answered } = distributionFor(q);
        const max = Math.max(1, ...counts);
        const typeLabel =
          q.type === 'checkbox'
            ? 'Checkboxes'
            : q.type === 'likert'
            ? 'Likert scale'
            : q.type === 'dropdown'
            ? 'Dropdown'
            : q.type === 'yesNo'
            ? 'Yes / No'
            : 'Multiple choice';
        return (
          <div className="qbreak-card" key={q.id}>
            {showSectionLabel && <div className="qbreak-section">{sec!.title}</div>}
            <h4>
              Q{qi + 1}. {q.text}
            </h4>
            <div className="qbreak-meta">
              {typeLabel} &middot; {answered} response{answered === 1 ? '' : 's'}
            </div>
            {answered === 0 ? (
              <p className="subtle-note">No responses yet.</p>
            ) : (
              q.options.map((opt, oi) => {
                const isLikert = q.type === 'likert';
                const isCorrectOpt =
                  q.type === 'checkbox'
                    ? (q.correctIndexes || []).includes(oi)
                    : q.type === 'mcq' || q.type === 'yesNo' || q.type === 'dropdown'
                    ? q.correctIndex === oi
                    : false;
                const c = counts[oi] || 0;
                const pct = Math.round((c / max) * 100);
                return (
                  <div className="qbreak-bar-row" key={oi}>
                    <div className="qbreak-bar-label">
                      <span className={`txt${isCorrectOpt ? ' is-correct-label' : ''}`}>
                        {isLikert ? `${oi + 1}. ` : `${LETTERS[oi] ?? oi + 1}. `}
                        {opt}
                        {isCorrectOpt ? ' \u2713' : ''}
                      </span>
                      <span className="cnt">{c}</span>
                    </div>
                    <div className="qbreak-track">
                      <div className={`qbreak-fill${isCorrectOpt ? ' is-correct' : ''}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        );
      })}
    </>
  );
}

Chart.register(
  ArcElement,
  BarElement,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  DoughnutController,
  BarController,
  LineController
);

const PALETTE = ['#8DCFBC', '#82ca9d', '#ffc658', '#ff7300', '#3CC290', '#00C49F', '#FFBB28', '#FF8042', '#a4de6c', '#98D6BC'];
const TEXT_DIM = '#5D7E72';
const GRID_SOFT = '#EEF7F4';
const LABEL_COLORS: Record<string, string> = {
  female: '#F472B6',
  feminine: '#F472B6',
  male: '#74D2B1',
  masculine: '#74D2B1',
  'non-binary': '#A4E1D1',
  intersex: '#34D399',
  unspecified: '#94B8AB',
  'prefer not to say': '#94B8AB',
};
function colorFor(label: string, i: number): string {
  return LABEL_COLORS[String(label).trim().toLowerCase()] ?? PALETTE[i % PALETTE.length];
}

interface Props {
  db: DB;
  refresh: () => void;
  selectedAssessmentId: string | null;
  setSelectedAssessmentId: (id: string) => void;
}

type DemoField = Exclude<keyof ResponseRecord['demographics'], 'custom'>;

/**
 * Tallies a demographic field across responses. When `order` is given (e.g.
 * the admin's configured age-bracket list) entries are sorted to match that
 * order instead of by raw frequency, so brackets like "18-24, 25-34, ..."
 * read left-to-right the way the admin defined them.
 */
function countBy(list: ResponseRecord[], field: DemoField, opts?: { limit?: number; order?: string[] }) {
  const counts: Record<string, number> = {};
  list.forEach((r) => {
    const v = r.demographics[field] || 'Unspecified';
    counts[v] = (counts[v] || 0) + 1;
  });
  let entries = Object.entries(counts);
  if (opts?.order && opts.order.length) {
    const orderIndex = new Map(opts.order.map((v, i) => [v, i]));
    entries.sort((a, b) => {
      const ia = orderIndex.has(a[0]) ? (orderIndex.get(a[0]) as number) : Infinity;
      const ib = orderIndex.has(b[0]) ? (orderIndex.get(b[0]) as number) : Infinity;
      return ia !== ib ? ia - ib : b[1] - a[1];
    });
  } else {
    entries.sort((a, b) => b[1] - a[1]);
  }
  if (opts?.limit) entries = entries.slice(0, opts.limit);
  return entries;
}

/**
 * Tallies one admin-defined (custom) registration field. Blank/missing answers
 * — e.g. people who registered before the field was added — count as
 * "Unspecified". Dropdown options keep the order the admin set them in.
 */
function countCustom(list: ResponseRecord[], cf: CustomField) {
  const counts: Record<string, number> = {};
  list.forEach((r) => {
    const v = (r.demographics.custom?.[cf.id] || '').trim() || 'Unspecified';
    counts[v] = (counts[v] || 0) + 1;
  });
  const order = new Map(cf.options.map((o, i) => [o, i]));
  return Object.entries(counts).sort((a, b) => {
    const ia = order.has(a[0]) ? (order.get(a[0]) as number) : Infinity;
    const ib = order.has(b[0]) ? (order.get(b[0]) as number) : Infinity;
    return ia !== ib ? ia - ib : b[1] - a[1];
  });
}

/** Free-text answers to a custom text field, skipping blanks. */
function customTextAnswers(list: ResponseRecord[], cf: CustomField) {
  return list
    .map((r) => ({ id: r.id, name: r.demographics.name, value: (r.demographics.custom?.[cf.id] || '').trim() }))
    .filter((x) => x.value);
}

/**
 * Builds a row x column count matrix for two demographic fields — shared by
 * "Top organizations by age" (rows = org, columns = age) and the
 * "Age vs Sector" demographic overlay (rows = age, columns = sector).
 */
function crossTab(list: ResponseRecord[], rowField: DemoField, colField: DemoField, opts?: { rowLimit?: number; rowOrder?: string[]; colOrder?: string[] }) {
  const rowTotals: Record<string, number> = {};
  list.forEach((r) => {
    const rv = r.demographics[rowField] || 'Unspecified';
    rowTotals[rv] = (rowTotals[rv] || 0) + 1;
  });
  let rowLabels = Object.entries(rowTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
  if (opts?.rowOrder && opts.rowOrder.length) {
    const idx = new Map(opts.rowOrder.map((v, i) => [v, i]));
    rowLabels = rowLabels
      .slice()
      .sort((a, b) => (idx.has(a) ? (idx.get(a) as number) : Infinity) - (idx.has(b) ? (idx.get(b) as number) : Infinity));
  }
  if (opts?.rowLimit) rowLabels = rowLabels.slice(0, opts.rowLimit);

  const colSet = new Set<string>();
  list.forEach((r) => colSet.add(r.demographics[colField] || 'Unspecified'));
  let colLabels = Array.from(colSet);
  if (opts?.colOrder && opts.colOrder.length) {
    const idx = new Map(opts.colOrder.map((v, i) => [v, i]));
    colLabels.sort((a, b) => (idx.has(a) ? (idx.get(a) as number) : Infinity) - (idx.has(b) ? (idx.get(b) as number) : Infinity));
  } else {
    colLabels.sort();
  }

  const rowLabelSet = new Set(rowLabels);
  const matrix = rowLabels.map((rl) => colLabels.map(() => 0));
  list.forEach((r) => {
    const rv = r.demographics[rowField] || 'Unspecified';
    if (!rowLabelSet.has(rv)) return;
    const cv = r.demographics[colField] || 'Unspecified';
    const ri = rowLabels.indexOf(rv);
    const ci = colLabels.indexOf(cv);
    if (ri >= 0 && ci >= 0) matrix[ri][ci]++;
  });
  return { rowLabels, colLabels, matrix };
}

/** Average understanding-level percentage per submission day, oldest first. */
function trendByDate(list: ResponseRecord[]) {
  const byDay: Record<string, { sum: number; n: number }> = {};
  list.forEach((r) => {
    const day = r.submittedAt.slice(0, 10);
    const pct = r.totalQuestions > 0 ? (r.correctCount / r.totalQuestions) * 100 : 0;
    if (!byDay[day]) byDay[day] = { sum: 0, n: 0 };
    byDay[day].sum += pct;
    byDay[day].n += 1;
  });
  const days = Object.keys(byDay).sort();
  return { labels: days, data: days.map((d) => Math.round(byDay[d].sum / byDay[d].n)) };
}

/**
 * The data model has no explicit "exempted" status today — a ResponseRecord
 * only exists once a participant submits. Until such a flag is added, a
 * response is treated as "incomplete" when it has fewer recorded answers
 * than the question count it was scored against.
 */
function isCompleteResponse(r: ResponseRecord) {
  return r.totalQuestions > 0 && r.answers.length >= r.totalQuestions;
}

function doughnutConfig(labels: string[], data: number[]): ChartConfiguration {
  const total = data.reduce((s, v) => s + (v || 0), 0);
  return {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data, backgroundColor: labels.map((l, i) => colorFor(l, i)), borderColor: '#ffffff', borderWidth: 2 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: TEXT_DIM,
            font: { size: 11 },
            boxWidth: 10,
            padding: 10,
            generateLabels: (chart: any) => {
              const values = (chart.data.datasets[0].data ?? []) as number[];
              const t = values.reduce((s: number, v: number) => s + (v || 0), 0);
              return (chart.data.labels ?? []).map((label: string, i: number) => {
                const value = values[i] || 0;
                const pct = t > 0 ? Math.round((value / t) * 100) : 0;
                return {
                  text: `${label} (${pct}%)`,
                  fillStyle: colorFor(label, i),
                  strokeStyle: '#ffffff',
                  lineWidth: 2,
                  index: i,
                };
              });
            },
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx: any) => {
              const value = ctx.parsed as number;
              const pct = total > 0 ? Math.round((value / total) * 100) : 0;
              return `${ctx.label}: ${value} (${pct}%)`;
            },
          },
        },
      },
    },
  };
}

function horizontalBarConfig(labels: string[], data: number[]): ChartConfiguration {
  return {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: PALETTE[0], borderRadius: 4, barThickness: 16 }] },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, ticks: { color: TEXT_DIM, precision: 0 }, grid: { color: GRID_SOFT } },
        y: { ticks: { color: TEXT_DIM, font: { size: 11.5 } }, grid: { display: false } },
      },
    },
  };
}

/** Stacked (or grouped) bar — one dataset per column label, one bar group per row label. */
function crossTabBarConfig(
  rowLabels: string[],
  colLabels: string[],
  matrix: number[][],
  opts?: { horizontal?: boolean }
): ChartConfiguration {
  const datasets = colLabels.map((cl, ci) => ({
    label: cl,
    data: matrix.map((row) => row[ci]),
    backgroundColor: PALETTE[ci % PALETTE.length],
    borderRadius: 3,
  }));
  return {
    type: 'bar',
    data: { labels: rowLabels, datasets },
    options: {
      indexAxis: opts?.horizontal ? 'y' : 'x',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { color: TEXT_DIM, font: { size: 10.5 }, boxWidth: 10, padding: 8 } } },
      scales: {
        x: { stacked: true, ticks: { color: TEXT_DIM, font: { size: 11 } }, grid: { color: GRID_SOFT } },
        y: { stacked: true, ticks: { color: TEXT_DIM, font: { size: 11 } }, grid: { display: false } },
      },
    },
  };
}

/** Line-only trend — no per-point markers, per the design spec. */
function trendLineConfig(labels: string[], data: number[]): ChartConfiguration {
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          data,
          borderColor: PALETTE[0],
          backgroundColor: 'rgba(141,207,188,.15)',
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          pointHoverRadius: 4,
          borderWidth: 2.5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: TEXT_DIM, font: { size: 11 } }, grid: { display: false } },
        y: { beginAtZero: true, max: 100, ticks: { color: TEXT_DIM, callback: (v) => `${v}%` }, grid: { color: GRID_SOFT } },
      },
    },
  };
}

type SortKey = 'submittedAt' | 'name' | 'email' | 'score' | 'correct';
const PAGE_SIZE = 10;

function SortableTh({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: 'asc' | 'desc';
  onSort: (k: SortKey) => void;
}) {
  const active = sortKey === activeKey;
  return (
    <th>
      <button type="button" className={`sort-th-btn${active ? ' active' : ''}`} onClick={() => onSort(sortKey)}>
        {label}
        <span className="sort-arrow">{active ? (dir === 'asc' ? '\u25B2' : '\u25BC') : ''}</span>
      </button>
    </th>
  );
}

export default function AnalyticsTab({ db, refresh, selectedAssessmentId, setSelectedAssessmentId }: Props) {
  const canvasMapRef = useRef<Record<string, HTMLCanvasElement | null>>({});
  // Insight cards register here instead: the PDF export stretches every canvas in
  // canvasMapRef to a fixed box, which would distort these taller charts.
  const insightMapRef = useRef<Record<string, HTMLCanvasElement | null>>({});
  const [viewingResponse, setViewingResponse] = useState<ResponseRecord | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [section, setSection] = useState<'performance' | 'registration' | 'questions' | 'responses'>('performance');

  useEffect(() => {
    if (!selectedAssessmentId && db.assessments[0]) {
      setSelectedAssessmentId(db.assessments[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.assessments]);

  useEffect(() => {
    setPage(1);
  }, [selectedAssessmentId, searchQuery, sortKey, sortDir]);

  const list = db.responses.filter((r) => r.assessmentId === selectedAssessmentId);
  const a = db.assessments.find((x) => x.id === selectedAssessmentId);

  const stats = useMemo(() => {
    if (list.length === 0) return null;
    const avgPct = Math.round((list.reduce((s, r) => s + r.correctCount / r.totalQuestions, 0) / list.length) * 100);
    const levels = { Novice: 0, Competent: 0, Proficient: 0, Expert: 0 };
    list.forEach((r) => {
      const p = (r.correctCount / r.totalQuestions) * 100;
      if (p >= 91) levels.Expert++;
      else if (p >= 71) levels.Proficient++;
      else if (p >= 41) levels.Competent++;
      else levels.Novice++;
    });
    return { avgPct, levels };
  }, [list]);

  // Chart-ready shapes, memoized alongside `list` so they only recompute when
  // the underlying responses (or the selected assessment) actually change.
  const charts = useMemo(() => {
    if (list.length === 0) return null;
    const sex = countBy(list, 'sex');
    const gender = countBy(list, 'gender');
    const category = countBy(list, 'category', { limit: 10 });
    const orgByAge = crossTab(list, 'org', 'age', { rowLimit: 6, colOrder: db.fieldOptions.age });
    const ageBySector = crossTab(list, 'age', 'sector', { rowOrder: db.fieldOptions.age, colOrder: db.fieldOptions.sector });
    const trend = trendByDate(list);

    // Registration breakdown: every registration field, built from the same
    // field settings the registration form uses. Custom fields the admin adds
    // or removes in Settings appear here (or disappear) automatically.
    const fo = db.fieldOptions;
    const registration: { id: string; title: string; kind: 'doughnut' | 'bar'; entries: [string, number][] }[] = [
      { id: 'civilStatus', title: 'Civil status', kind: 'doughnut', entries: countBy(list, 'civilStatus', { order: fo.civilStatus }) },
      { id: 'age', title: 'Age range', kind: 'bar', entries: countBy(list, 'age', { order: fo.age }) },
      { id: 'sector', title: 'Type of sector', kind: 'bar', entries: countBy(list, 'sector', { order: fo.sector }) },
      { id: 'region', title: 'Region', kind: 'bar', entries: countBy(list, 'region', { limit: 10 }) },
      { id: 'province', title: 'Province', kind: 'bar', entries: countBy(list, 'province', { limit: 10 }) },
      { id: 'locality', title: 'Locality', kind: 'bar', entries: countBy(list, 'locality', { limit: 10 }) },
    ];
    const custom = fo.customFields.map((cf) => {
      const isText = (cf.type ?? 'dropdown') === 'text';
      return {
        cf,
        isText,
        entries: isText ? [] : countCustom(list, cf),
        answers: isText ? customTextAnswers(list, cf) : [],
      };
    });

    return { sex, gender, category, orgByAge, ageBySector, trend, registration, custom };
  }, [list, db.fieldOptions]);

  // Individual-responses table: excludes incomplete/exempted records (see
  // isCompleteResponse), then applies search, sort, and pagination.
  const completeList = useMemo(() => list.filter(isCompleteResponse), [list]);

  const tableRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let rows = completeList.filter((r) => {
      if (!q) return true;
      return (
        r.demographics.name.toLowerCase().includes(q) ||
        r.demographics.email.toLowerCase().includes(q) ||
        (r.demographics.org || '').toLowerCase().includes(q)
      );
    });
    rows = rows.slice().sort((x, y) => {
      let cmp = 0;
      if (sortKey === 'submittedAt') cmp = new Date(x.submittedAt).getTime() - new Date(y.submittedAt).getTime();
      else if (sortKey === 'name') cmp = x.demographics.name.localeCompare(y.demographics.name);
      else if (sortKey === 'email') cmp = x.demographics.email.localeCompare(y.demographics.email);
      else if (sortKey === 'correct') cmp = x.correctCount / x.totalQuestions - y.correctCount / y.totalQuestions;
      else cmp = x.totalScore - y.totalScore;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [completeList, searchQuery, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(tableRows.length / PAGE_SIZE));
  const pageRows = tableRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function handleSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir('desc');
    }
  }

  function handleExportPdf() {
    if (!a || list.length === 0) return;
    Object.values(canvasMapRef.current).forEach((c) =>
      (c as (HTMLCanvasElement & { __forceRender?: () => void }) | null)?.__forceRender?.()
    );
    const canvases = Object.entries(canvasMapRef.current)
      .filter(([, c]) => c)
      .map(([id, canvas]) => ({ id, canvas: canvas as HTMLCanvasElement }));
    exportPDF(a, list, canvases, db.fieldOptions.customFields);
    if (!a.exported) {
      import('@/lib/db').then(async ({ saveDB, loadDB }) => {
        const fresh = await loadDB();
        const idx = fresh.assessments.findIndex((x) => x.id === a.id);
        if (idx >= 0) fresh.assessments[idx].exported = true;
        await saveDB(fresh);
        refresh();
      });
    }
  }

  // Reveals chart cards, the question-breakdown grid, and the responses table
  // as they scroll into view. Re-runs whenever the selected assessment (and
  // thus the rendered set of cards) changes, so switching assessments replays
  // the reveal instead of leaving newly-mounted cards invisible.
  const revealRootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = revealRootRef.current;
    if (!root) return;
    const elements = Array.from(root.querySelectorAll<HTMLElement>('.scroll-reveal'));
    if (elements.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -60px 0px' }
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [charts, a]);

  return (
    <div ref={revealRootRef} className="analytics-page">
      <div className="admin-header anim-fade-up">
        <div>
          <h1>Analytics</h1>
          <p>Understanding level and demographic breakdown.</p>
        </div>
      </div>
      <div className="analytics-toolbar anim-fade-up">
        <select
          className="select-inline"
          value={selectedAssessmentId ?? ''}
          onChange={(e) => setSelectedAssessmentId(e.target.value)}
        >
          {db.assessments.length === 0 && <option>No assessments yet</option>}
          {db.assessments.map((x) => (
            <option key={x.id} value={x.id}>
              {x.title} ({x.code})
            </option>
          ))}
        </select>
        {list.length > 0 && (
          <button
            type="button"
            className="analytics-export-btn"
            onClick={handleExportPdf}
            title="Export PDF summary"
            aria-label="Export PDF summary"
          >
            <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M10 3v9.5M6.5 9.5 10 13l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 14.5v1A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5v-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {!stats || !charts ? (
        <div className="empty-state">
          <h3>Not enough data yet</h3>
          <p>Analytics will appear once responses come in.</p>
        </div>
      ) : (
        <>
          {/* --- KPI cards --- */}
          <div className="kpi-row anim-fade-up-stagger">
            <div className="kpi">
              <div className="n"><RollingNumber value={list.length} triggerKey={selectedAssessmentId} /></div>
              <div className="l">Total responses</div>
            </div>
            <div className="kpi">
              <div className="n"><RollingNumber value={stats.avgPct} suffix="%" triggerKey={selectedAssessmentId} delay={120} /></div>
              <div className="l">Understanding level</div>
            </div>
            <div className="kpi">
              <div className="n"><RollingNumber value={stats.levels.Proficient + stats.levels.Expert} triggerKey={selectedAssessmentId} delay={240} /></div>
              <div className="l">Proficient + Expert</div>
            </div>
            <div className="kpi">
              <div className="n"><RollingNumber value={stats.levels.Novice} triggerKey={selectedAssessmentId} delay={360} /></div>
              <div className="l">Needs training focus (Novice)</div>
            </div>
          </div>

          {/* --- Sub-tabs: one section at a time --- */}
          <div className="analytics-subtabs" role="tablist" aria-label="Analytics sections">
            {([
              ['performance', 'Performance insights'],
              ['registration', 'Registration'],
              ['questions', 'Questions'],
              ['responses', 'Responses'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={section === key}
                className={`analytics-subtab${section === key ? ' active' : ''}`}
                onClick={() => setSection(key)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className={`analytics-pane${section === 'performance' ? '' : ' is-hidden'}`} aria-hidden={section !== 'performance'}>
          {/* --- Performance insights: status-share donut, grouped stacked bars, top-N distributions --- */}
          <div className="admin-header scroll-reveal" style={{ marginTop: 6 }}>
            <div>
              <h1 style={{ fontSize: 19 }}>Performance insights</h1>
              <p>Understanding level by group. Bars show the top 3 &mdash; use View all to see every group.</p>
            </div>
          </div>
          <div className="insights-grid">
            <ShareCard list={list} mapRef={insightMapRef} />
            <StackedLevelCard
              id="ins_sector"
              title="Responses by Sector"
              subtitle="Respondents grouped by sector and understanding level"
              field="sector"
              list={list}
              mapRef={insightMapRef}
            />
            <StackedLevelCard
              id="ins_locality"
              title="Responses by Locality"
              subtitle="Respondents grouped by locality and understanding level"
              field="locality"
              list={list}
              mapRef={insightMapRef}
            />
            <TopListCard
              id="ins_category"
              title="Category Distribution"
              subtitle="Respondents grouped by category"
              field="category"
              list={list}
              mapRef={insightMapRef}
              color="#8DCFBC"
            />
            <TopListCard
              id="ins_org"
              title="Organization Distribution"
              subtitle="Respondents grouped by organization"
              field="org"
              list={list}
              mapRef={insightMapRef}
              color="#C98A2B"
            />
            <TopListCard
              id="ins_position"
              title="Position Distribution"
              subtitle="Respondents grouped by position"
              field="position"
              list={list}
              mapRef={insightMapRef}
              color="#2E8B57"
            />
          </div>

          {/* --- Doughnuts: 3-up row, then 2-column grid --- */}
          <div className="charts-grid-3col">
            <div className="chart-card scroll-reveal">
              <CopyChartButton title="Sex breakdown" canvasId="ch_sex" mapRef={canvasMapRef} />
<h4>Sex breakdown</h4>
              <div className="chart-box">
                <ChartCanvas id="ch_sex" config={doughnutConfig(charts.sex.map((e) => e[0]), charts.sex.map((e) => e[1]))} canvasMapRef={canvasMapRef} />
              </div>
            </div>

            <div className="chart-card scroll-reveal">
              <CopyChartButton title="Gender breakdown" canvasId="ch_gender" mapRef={canvasMapRef} />
<h4>Gender breakdown</h4>
              <div className="chart-box">
                <ChartCanvas
                  id="ch_gender"
                  config={doughnutConfig(charts.gender.map((e) => e[0]), charts.gender.map((e) => e[1]))}
                  canvasMapRef={canvasMapRef}
                />
              </div>
            </div>

            <div className="chart-card scroll-reveal">
              <CopyChartButton title="Understanding level breakdown" canvasId="ch_level" mapRef={canvasMapRef} />
<h4>Understanding level breakdown</h4>
              <div className="chart-box">
                <ChartCanvas
                  id="ch_level"
                  config={doughnutConfig(
                    ['Novice', 'Competent', 'Proficient', 'Expert'],
                    [stats.levels.Novice, stats.levels.Competent, stats.levels.Proficient, stats.levels.Expert]
                  )}
                  canvasMapRef={canvasMapRef}
                />
              </div>
            </div>
          </div>

          <div className="charts-grid-2col">
            <div className="chart-card scroll-reveal">
              <CopyChartButton title="Top organizations by age" canvasId="ch_org_age" mapRef={canvasMapRef} />
<h4>Top organizations by age</h4>
              <div className="chart-box chart-box-tall">
                <ChartCanvas
                  id="ch_org_age"
                  config={crossTabBarConfig(charts.orgByAge.rowLabels, charts.orgByAge.colLabels, charts.orgByAge.matrix, { horizontal: true })}
                  canvasMapRef={canvasMapRef}
                />
              </div>
            </div>

            <div className="chart-card scroll-reveal">
              <CopyChartButton title="Field registration" subtitle="By category" canvasId="ch_category" mapRef={canvasMapRef} />
<h4>Field registration</h4>
              <p className="chart-subnote">By category</p>
              <div className="chart-box chart-box-tall">
                <ChartCanvas
                  id="ch_category"
                  config={horizontalBarConfig(charts.category.map((e) => e[0]), charts.category.map((e) => e[1]))}
                  canvasMapRef={canvasMapRef}
                />
              </div>
            </div>

            <div className="chart-card scroll-reveal">
              <CopyChartButton title="Demographics overlay" subtitle="Age vs sector" canvasId="ch_age_sector" mapRef={canvasMapRef} />
<h4>Demographics overlay</h4>
              <p className="chart-subnote">Age vs sector</p>
              <div className="chart-box chart-box-tall">
                <ChartCanvas
                  id="ch_age_sector"
                  config={crossTabBarConfig(charts.ageBySector.rowLabels, charts.ageBySector.colLabels, charts.ageBySector.matrix)}
                  canvasMapRef={canvasMapRef}
                />
              </div>
            </div>

            <div className="chart-card scroll-reveal">
              {charts.trend.labels.length >= 2 && <CopyChartButton title="Understanding level trend" subtitle="Daily average score" canvasId="ch_trend" mapRef={canvasMapRef} />}
<h4>Understanding level trend</h4>
              <p className="chart-subnote">Daily average score</p>
              <div className="chart-box chart-box-tall">
                {charts.trend.labels.length < 2 ? (
                  <p className="subtle-note">Trend appears once responses span more than one day.</p>
                ) : (
                  <ChartCanvas id="ch_trend" config={trendLineConfig(charts.trend.labels, charts.trend.data)} canvasMapRef={canvasMapRef} />
                )}
              </div>
            </div>
          </div>
          </div>

          <div className={`analytics-pane${section === 'registration' ? '' : ' is-hidden'}`} aria-hidden={section !== 'registration'}>
          {/* --- Registration breakdown: mirrors the registration form, including admin-added custom fields --- */}
          <div className="admin-header scroll-reveal" style={{ marginTop: 34 }}>
            <div>
              <h1 style={{ fontSize: 19 }}>Registration breakdown</h1>
              <p>Every registration field, including any custom fields added in Settings.</p>
            </div>
          </div>
          <div className="charts-grid-2col">
            {charts.registration.map((rc) => (
              <div className="chart-card scroll-reveal" key={rc.id}>
                <CopyChartButton title={rc.title} canvasId={`ch_reg_${rc.id}`} mapRef={canvasMapRef} />
<h4>{rc.title}</h4>
                <div className="chart-box chart-box-tall">
                  <ChartCanvas
                    id={`ch_reg_${rc.id}`}
                    config={
                      rc.kind === 'doughnut'
                        ? doughnutConfig(rc.entries.map((e) => e[0]), rc.entries.map((e) => e[1]))
                        : horizontalBarConfig(rc.entries.map((e) => e[0]), rc.entries.map((e) => e[1]))
                    }
                    canvasMapRef={canvasMapRef}
                  />
                </div>
              </div>
            ))}
            {charts.custom.map(({ cf, isText, entries, answers }) => (
              <div className="chart-card scroll-reveal" key={cf.id}>
                {!isText && <CopyChartButton title={cf.label} canvasId={`ch_custom_${cf.id}`} mapRef={canvasMapRef} />}
<h4>{cf.label}</h4>
                <p className="chart-subnote">
                  Custom field {'\u00b7'} {isText ? `Text (${answers.length} of ${list.length} answered)` : 'Dropdown'}
                </p>
                {isText ? (
                  answers.length === 0 ? (
                    <p className="subtle-note">No answers yet.</p>
                  ) : (
                    <div className="qbreak-answers-list">
                      {answers.map((x) => (
                        <div className="qbreak-answer-item" key={x.id}>
                          {x.value}
                          <div className="subtle-note" style={{ marginTop: 2 }}>{x.name}</div>
                        </div>
                      ))}
                    </div>
                  )
                ) : (
                  <div className="chart-box chart-box-tall">
                    <ChartCanvas
                      id={`ch_custom_${cf.id}`}
                      config={horizontalBarConfig(entries.map((e) => e[0]), entries.map((e) => e[1]))}
                      canvasMapRef={canvasMapRef}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
          </div>

          {a && (
            <>
              <div className={`analytics-pane${section === 'questions' ? '' : ' is-hidden'}`} aria-hidden={section !== 'questions'}>
              {/* --- Question analysis, 2-column layout --- */}
              <div className="admin-header scroll-reveal" style={{ marginTop: 34 }}>
                <div>
                  <h1 style={{ fontSize: 19 }}>Question breakdown</h1>
                  <p>How respondents answered each question — Summary view, like Google Forms.</p>
                </div>
              </div>
              <div className="qbreak-grid-2col scroll-reveal">
                <QuestionBreakdown a={a} list={list} />
              </div>
              </div>

              <div className={`analytics-pane${section === 'responses' ? '' : ' is-hidden'}`} aria-hidden={section !== 'responses'}>
              {/* --- Individual responses --- */}
              <div className="admin-header scroll-reveal" style={{ marginTop: 34 }}>
                <div>
                  <h1 style={{ fontSize: 19 }}>Individual responses</h1>
                  <p>Browse each respondent&apos;s full answer set. Incomplete or exempted responses are excluded.</p>
                </div>
              </div>
              <div className="toolbar">
                <input
                  type="text"
                  inputMode="search"
                  autoComplete="off"
                  className="search-inline"
                  placeholder="Search by name, email, or organization…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <span className="subtle-note" style={{ marginLeft: 'auto', marginTop: 0 }}>
                  {tableRows.length} response{tableRows.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="table-wrap scroll-reveal">
                <table className="data-table">
                  <thead>
                    <tr>
                      <SortableTh label="Submitted" sortKey="submittedAt" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                      <SortableTh label="Name" sortKey="name" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                      <SortableTh label="Email" sortKey="email" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                      <SortableTh label="Score" sortKey="score" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                      <SortableTh label="Correct" sortKey="correct" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="subtle-note" style={{ textAlign: 'center', padding: '24px 12px' }}>
                          No matching responses.
                        </td>
                      </tr>
                    ) : (
                      pageRows.map((r) => (
                        <tr key={r.id} className="row-clickable" onClick={() => setViewingResponse(r)}>
                          <td>{r.submittedAt.slice(0, 10)}</td>
                          <td>{r.demographics.name}</td>
                          <td>{r.demographics.email}</td>
                          <td>{r.totalScore} pts</td>
                          <td>
                            {r.correctCount}/{r.totalQuestions}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className="pagination">
                  <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    &#8592; Prev
                  </button>
                  <span className="subtle-note">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next &#8594;
                  </button>
                </div>
              )}
              </div>
            </>
          )}
        </>
      )}

      {viewingResponse && a && (
        <RespondentModal
          assessment={a}
          response={viewingResponse}
          customFields={db.fieldOptions.customFields}
          onClose={() => setViewingResponse(null)}
        />
      )}
    </div>
  );
}