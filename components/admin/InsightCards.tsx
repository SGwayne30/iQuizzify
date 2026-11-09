'use client';
import { useState, type MutableRefObject, type ReactNode } from 'react';
import type { ChartConfiguration, Plugin } from 'chart.js';
import type { ResponseRecord } from '@/lib/types';
import ChartCanvas from './ChartCanvas';

/* ------------------------------------------------------------------ *
 * Status-share analytics: a "share" donut with a headline percentage,
 * grouped stacked bars split by status, and top-N distributions with a
 * "View all (N)" toggle. Here the "status" of a response is its
 * understanding level (Novice / Competent / Proficient / Expert).
 * ------------------------------------------------------------------ */

export const LEVELS = ['Novice', 'Competent', 'Proficient', 'Expert'] as const;
export type Level = (typeof LEVELS)[number];

const LEVEL_COLORS: Record<Level, string> = {
  Novice: '#B3404C',
  Competent: '#C98A2B',
  Proficient: '#41A17F',
  Expert: '#2E8B57',
};
const GOOD = '#2E8B57';
const BAD = '#B3404C';
const TEXT = '#24473A';
const TEXT_DIM = '#5D7E72';
const TEXT_FAINT = '#88A79C';
const GRID_SOFT = '#EEF7F4';
const DEFAULT_VISIBLE = 3;

type DemoField = Exclude<keyof ResponseRecord['demographics'], 'custom'>;
type MapRef = MutableRefObject<Record<string, HTMLCanvasElement | null>>;

/** Same thresholds the rest of the Analytics tab uses. */
export function levelOf(r: ResponseRecord): Level {
  const p = r.totalQuestions > 0 ? (r.correctCount / r.totalQuestions) * 100 : 0;
  if (p >= 91) return 'Expert';
  if (p >= 71) return 'Proficient';
  if (p >= 41) return 'Competent';
  return 'Novice';
}

function valueOf(r: ResponseRecord, field: DemoField): string {
  return String(r.demographics[field] ?? '').trim() || 'Unspecified';
}

/** Rows of [Novice, Competent, Proficient, Expert] counts per group, largest group first. */
function groupByLevel(list: ResponseRecord[], field: DemoField) {
  const map = new Map<string, number[]>();
  list.forEach((r) => {
    const key = valueOf(r, field);
    const row = map.get(key) ?? [0, 0, 0, 0];
    row[LEVELS.indexOf(levelOf(r))]++;
    map.set(key, row);
  });
  return Array.from(map.entries())
    .map(([label, counts]) => ({ label, counts, total: counts.reduce((s, v) => s + v, 0) }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

/** Plain frequency table, largest first. */
function tally(list: ResponseRecord[], field: DemoField) {
  const map = new Map<string, number>();
  list.forEach((r) => {
    const key = valueOf(r, field);
    map.set(key, (map.get(key) ?? 0) + 1);
  });
  return Array.from(map.entries())
    .map(([label, total]) => ({ label, total }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

/** Wraps a long category label onto several lines so it fits the y-axis. */
function wrapLabel(label: string, max = 16): string | string[] {
  if (label.length <= max) return label;
  const lines: string[] = [];
  let line = '';
  label.split(/\s+/).forEach((word) => {
    if (line && (line + ' ' + word).length > max) {
      lines.push(line);
      line = word;
    } else {
      line = line ? line + ' ' + word : word;
    }
  });
  if (line) lines.push(line);
  return lines;
}

function bodyFont() {
  return typeof document !== 'undefined' ? getComputedStyle(document.body).fontFamily : 'sans-serif';
}

/**
 * Draws the count inside each stacked segment (when it's wide enough) and the
 * running total just past the end of each bar. Reads visibility from the
 * chart, so toggling a legend entry updates the totals too.
 */
function valueLabelsPlugin(inside: boolean): Plugin {
  return {
    id: 'insightValueLabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const labels = chart.data.labels ?? [];
      ctx.save();
      ctx.textBaseline = 'middle';
      ctx.font = `700 11px ${bodyFont()}`;

      if (inside) {
        chart.data.datasets.forEach((ds, di) => {
          if (!chart.isDatasetVisible(di)) return;
          chart.getDatasetMeta(di).data.forEach((el, i) => {
            const v = Number(ds.data[i]) || 0;
            const bar = el as unknown as { x: number; y: number; base: number };
            if (!v || Math.abs(bar.x - bar.base) < 18) return;
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.fillText(String(v), (bar.x + bar.base) / 2, bar.y);
          });
        });
      }

      ctx.font = `600 12px ${bodyFont()}`;
      ctx.fillStyle = TEXT;
      ctx.textAlign = 'left';
      labels.forEach((_, i) => {
        let total = 0;
        let endX = -Infinity;
        let y = 0;
        chart.data.datasets.forEach((ds, di) => {
          if (!chart.isDatasetVisible(di)) return;
          const el = chart.getDatasetMeta(di).data[i] as unknown as { x: number; y: number } | undefined;
          if (!el) return;
          total += Number(ds.data[i]) || 0;
          if (el.x > endX) endX = el.x;
          y = el.y;
        });
        if (endX > -Infinity) ctx.fillText(String(total), endX + 8, y);
      });
      ctx.restore();
    },
  };
}

/** Big headline percentage in the middle of the doughnut. */
function centerTextPlugin(main: string, sub: string, color: string): Plugin {
  return {
    id: 'insightCenterText',
    afterDraw(chart) {
      const { ctx, chartArea } = chart;
      if (!chartArea) return;
      const cx = (chartArea.left + chartArea.right) / 2;
      const cy = (chartArea.top + chartArea.bottom) / 2;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = color;
      ctx.font = `800 30px ${bodyFont()}`;
      ctx.fillText(main, cx, cy - 8);
      ctx.fillStyle = TEXT_FAINT;
      ctx.font = `600 11px ${bodyFont()}`;
      ctx.fillText(sub, cx, cy + 20);
      ctx.restore();
    },
  };
}

function shareConfig(good: number, bad: number, pctText: string): ChartConfiguration {
  const total = good + bad;
  return {
    type: 'doughnut',
    data: {
      labels: ['Proficient + Expert', 'Novice + Competent'],
      datasets: [{ data: [good, bad], backgroundColor: [GOOD, BAD], borderColor: '#ffffff', borderWidth: 3 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
            ...({ cutout: '76%' } as object),
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed as number;
              return `${ctx.label}: ${v} (${total > 0 ? Math.round((v / total) * 100) : 0}%)`;
            },
          },
        },
      },
    },
    plugins: [centerTextPlugin(pctText, 'PROFICIENT SHARE', GOOD)],
  };
}

function stackedConfig(rows: { label: string; counts: number[]; total: number }[]): ChartConfiguration {
  const maxTotal = Math.max(1, ...rows.map((r) => r.total));
  return {
    type: 'bar',
    data: {
      labels: rows.map((r) => wrapLabel(r.label)) as unknown as string[],
      datasets: LEVELS.map((lv, li) => ({
        label: lv,
        data: rows.map((r) => r.counts[li]),
        backgroundColor: LEVEL_COLORS[lv],
        borderWidth: 0,
        barThickness: 26,
      })),
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: 34 } },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { usePointStyle: true, pointStyle: 'rect', boxWidth: 9, boxHeight: 9, color: TEXT_DIM, font: { size: 11 }, padding: 14 },
        },
        tooltip: {
          callbacks: {
            footer: (items) => {
              const i = items[0]?.dataIndex ?? 0;
              return `Total: ${rows[i]?.total ?? 0}`;
            },
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          beginAtZero: true,
          suggestedMax: Math.ceil(maxTotal * 1.05),
          ticks: { color: TEXT_FAINT, precision: 0, font: { size: 10.5 } },
          grid: { color: GRID_SOFT, borderDash: [3, 4] } as never,
        },
        y: { stacked: true, ticks: { color: TEXT_DIM, font: { size: 11.5 } }, grid: { display: false } },
      },
    },
    plugins: [valueLabelsPlugin(true)],
  };
}

function singleBarConfig(rows: { label: string; total: number }[], color: string): ChartConfiguration {
  const maxTotal = Math.max(1, ...rows.map((r) => r.total));
  return {
    type: 'bar',
    data: {
      labels: rows.map((r) => wrapLabel(r.label)) as unknown as string[],
      datasets: [{ data: rows.map((r) => r.total), backgroundColor: color, borderRadius: 6, borderSkipped: false, barThickness: 20 }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: 34 } },
      plugins: { legend: { display: false } },
      scales: {
        x: {
          beginAtZero: true,
          suggestedMax: Math.ceil(maxTotal * 1.05),
          ticks: { color: TEXT_FAINT, precision: 0, font: { size: 10.5 } },
          grid: { color: GRID_SOFT, borderDash: [3, 4] } as never,
        },
        y: { ticks: { color: TEXT_DIM, font: { size: 11.5 } }, grid: { display: false } },
      },
    },
    plugins: [valueLabelsPlugin(false)],
  };
}

/* ------------------------------ Copy section ------------------------------ */

type CopyState = 'idle' | 'copied' | 'saved' | 'failed';

/**
 * Renders the card's title, subtitle, chart and an optional footer line to a
 * PNG and puts it on the clipboard. Falls back to downloading the PNG when the
 * browser blocks image clipboard writes (e.g. plain-HTTP LAN access).
 */
async function copyCardImage(opts: { title: string; subtitle?: string; canvas: HTMLCanvasElement | null; footer?: string }): Promise<CopyState> {
  const { title, subtitle, canvas, footer } = opts;
  if (!canvas) return 'failed';
  (canvas as HTMLCanvasElement & { __forceRender?: () => void }).__forceRender?.();

  const dpr = canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1;
  const pad = Math.round(24 * dpr);
  const headH = Math.round((subtitle ? 62 : 44) * dpr);
  const footH = footer ? Math.round(34 * dpr) : 0;
  const out = document.createElement('canvas');
  out.width = canvas.width + pad * 2;
  out.height = headH + canvas.height + footH + pad;
  const ctx = out.getContext('2d');
  if (!ctx) return 'failed';

  const font = bodyFont();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.textBaseline = 'top';
  ctx.fillStyle = TEXT;
  ctx.font = `700 ${Math.round(16 * dpr)}px ${font}`;
  ctx.fillText(title, pad, pad * 0.8);
  if (subtitle) {
    ctx.fillStyle = TEXT_FAINT;
    ctx.font = `500 ${Math.round(12 * dpr)}px ${font}`;
    ctx.fillText(subtitle, pad, pad * 0.8 + 24 * dpr);
  }
  ctx.drawImage(canvas, pad, headH);
  if (footer) {
    ctx.fillStyle = TEXT_DIM;
    ctx.font = `600 ${Math.round(12.5 * dpr)}px ${font}`;
    ctx.fillText(footer, pad, headH + canvas.height + 8 * dpr);
  }

  return deliverPng(out, title);
}

/** Puts a finished canvas on the clipboard as a PNG, or downloads it when the browser blocks that. */
async function deliverPng(out: HTMLCanvasElement, title: string): Promise<CopyState> {
  const blob: Blob | null = await new Promise((resolve) => out.toBlob(resolve, 'image/png'));
  if (!blob) return 'failed';

  try {
    if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return 'copied';
    }
  } catch {
    // fall through to download
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return 'saved';
  } catch {
    return 'failed';
  }
}

/** Fills a rounded rectangle (canvas roundRect is not available in every browser). */
function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * Draws one element (and everything inside it) onto the canvas exactly as the browser laid it out:
 * its background and border, its coloured dots, and every word of text at the position the browser
 * gave it. Measuring word by word keeps line breaks identical to the screen (e.g. "Proficient + /
 * Expert" wrapping inside a narrow tile).
 */
function paintElement(ctx: CanvasRenderingContext2D, el: HTMLElement, origin: { x: number; y: number }, dpr: number, offset: { left: number; top: number }) {
  const toX = (v: number) => offset.left + (v - origin.x) * dpr;
  const toY = (v: number) => offset.top + (v - origin.y) * dpr;

  const box = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const bg = cs.backgroundColor;
  const borderW = parseFloat(cs.borderTopWidth) || 0;
  const radius = (parseFloat(cs.borderTopLeftRadius) || 0) * dpr;

  if (el.tagName === 'I') {
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.ellipse(toX(box.left + box.width / 2), toY(box.top + box.height / 2), (box.width / 2) * dpr, (box.height / 2) * dpr, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
    roundedRect(ctx, toX(box.left), toY(box.top), box.width * dpr, box.height * dpr, radius);
    ctx.fillStyle = bg;
    ctx.fill();
  }
  if (borderW > 0 && cs.borderTopStyle !== 'none') {
    roundedRect(ctx, toX(box.left) + (borderW * dpr) / 2, toY(box.top) + (borderW * dpr) / 2, box.width * dpr - borderW * dpr, box.height * dpr - borderW * dpr, radius);
    ctx.lineWidth = borderW * dpr;
    ctx.strokeStyle = cs.borderTopColor;
    ctx.stroke();
  }

  el.childNodes.forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      paintElement(ctx, node as HTMLElement, origin, dpr, offset);
      return;
    }
    if (node.nodeType !== Node.TEXT_NODE) return;

    const text = node.textContent ?? '';
    const upper = cs.textTransform === 'uppercase';
    ctx.font = `${cs.fontWeight} ${parseFloat(cs.fontSize) * dpr}px ${cs.fontFamily}`;
    ctx.fillStyle = cs.color;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing =
      cs.letterSpacing === 'normal' ? '0px' : `${parseFloat(cs.letterSpacing) * dpr}px`;

    const range = document.createRange();
    const wordPattern = /\S+/g;
    let match: RegExpExecArray | null;
    while ((match = wordPattern.exec(text)) !== null) {
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      const r = range.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      ctx.fillText(upper ? match[0].toUpperCase() : match[0], toX(r.left), toY(r.top + r.height / 2));
    }
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0px';
  });
}

/**
 * "Copy section" for the Proficient Share card. The card is the donut (a canvas, with the headline
 * percentage drawn inside it) plus three stat tiles that are ordinary page elements, so copying the
 * canvas alone lost the tiles. This rebuilds the whole card body from what is on screen.
 */
async function copyShareCardImage(opts: { title: string; subtitle: string; canvas: HTMLCanvasElement | null }): Promise<CopyState> {
  const { title, subtitle, canvas } = opts;
  if (!canvas) return 'failed';
  (canvas as HTMLCanvasElement & { __forceRender?: () => void }).__forceRender?.();

  const layout = canvas.closest('.share-layout') as HTMLElement | null;
  const stats = layout?.querySelector('.share-stats') as HTMLElement | null;
  if (!layout || !stats) return copyCardImage({ title, subtitle, canvas });

  const dpr = canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1;
  const pad = Math.round(24 * dpr);
  const headH = Math.round(62 * dpr);
  const box = layout.getBoundingClientRect();

  const out = document.createElement('canvas');
  out.width = Math.round(box.width * dpr) + pad * 2;
  out.height = headH + Math.round(box.height * dpr) + pad;
  const ctx = out.getContext('2d');
  if (!ctx) return 'failed';

  const font = bodyFont();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.textBaseline = 'top';
  ctx.fillStyle = TEXT;
  ctx.font = `700 ${Math.round(16 * dpr)}px ${font}`;
  ctx.fillText(title, pad, pad * 0.8);
  ctx.fillStyle = TEXT_FAINT;
  ctx.font = `500 ${Math.round(12 * dpr)}px ${font}`;
  ctx.fillText(subtitle, pad, pad * 0.8 + 24 * dpr);

  const origin = { x: box.left, y: box.top };
  const offset = { left: pad, top: headH };

  // The donut, at the same place and size it has on screen.
  const c = canvas.getBoundingClientRect();
  ctx.drawImage(canvas, offset.left + (c.left - origin.x) * dpr, offset.top + (c.top - origin.y) * dpr, c.width * dpr, c.height * dpr);

  // The three stat tiles.
  Array.from(stats.children).forEach((tile) => paintElement(ctx, tile as HTMLElement, origin, dpr, offset));

  return deliverPng(out, title);
}

function CopyButton({ onCopy }: { onCopy: () => Promise<CopyState> }) {
  const [state, setState] = useState<CopyState>('idle');
  async function handle() {
    const result = await onCopy();
    setState(result);
    window.setTimeout(() => setState('idle'), 1600);
  }
  const label =
    state === 'copied' ? 'Copied!' : state === 'saved' ? 'Saved as PNG' : state === 'failed' ? 'Copy failed' : 'Copy section';
  return (
    <button
      type="button"
      className={`insight-copy${state !== 'idle' ? ` is-${state}` : ''}`}
      onClick={handle}
      data-label={label}
      aria-label={label}
    >
      {state === 'copied' || state === 'saved' ? (
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="m5 10.5 3.2 3.2L15 6.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect x="7" y="7" width="9" height="9" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}

function InsightCard({ title, subtitle, onCopy, children }: { title: string; subtitle: string; onCopy: () => Promise<CopyState>; children: ReactNode }) {
  return (
    <div className="chart-card insight-card scroll-reveal">
      <CopyButton onCopy={onCopy} />
      <h4>{title}</h4>
      <p className="insight-sub">{subtitle}</p>
      {children}
    </div>
  );
}

/** "Copy section" button for chart cards that live outside this file (uses the card's registered canvas). */
export function CopyChartButton({
  title,
  subtitle,
  canvasId,
  mapRef,
}: {
  title: string;
  subtitle?: string;
  canvasId: string;
  mapRef: MapRef;
}) {
  return <CopyButton onCopy={() => copyCardImage({ title, subtitle, canvas: mapRef.current[canvasId] ?? null })} />;
}

function ViewAll({ total, limit, expanded, onToggle }: { total: number; limit: number; expanded: boolean; onToggle: () => void }) {
  if (total <= limit) return null;
  return (
    <button type="button" className="insight-viewall" onClick={onToggle}>
      {expanded ? 'Show less' : `View all (${total})`}
    </button>
  );
}

/* --------------------------------- Cards --------------------------------- */

/** Share of responses that reached Proficient or Expert, with total / good / below counts. */
export function ShareCard({ list, mapRef, id = 'ins_share' }: { list: ResponseRecord[]; mapRef: MapRef; id?: string }) {
  const counts = [0, 0, 0, 0];
  list.forEach((r) => counts[LEVELS.indexOf(levelOf(r))]++);
  const good = counts[2] + counts[3];
  const bad = counts[0] + counts[1];
  const total = good + bad;
  const pct = total > 0 ? (good / total) * 100 : 0;
  const pctText = `${pct.toFixed(2)}%`;
  const title = 'Proficient Share of Responses';
  const subtitle = 'Proficient + Expert out of all responses';

  return (
    <InsightCard
      title={title}
      subtitle={subtitle}
      onCopy={() => copyShareCardImage({ title, subtitle, canvas: mapRef.current[id] ?? null })}
    >
      <div className="share-layout">
        <div className="share-donut">
          <ChartCanvas id={id} config={shareConfig(good, bad, pctText)} canvasMapRef={mapRef} />
        </div>
        <div className="share-stats">
          <div className="share-stat total">
            <span className="share-stat-label">Total responses</span>
            <span className="share-stat-value">{total}</span>
          </div>
          <div className="share-stat good">
            <span className="share-stat-name">
              <i style={{ background: GOOD }} />
              Proficient + Expert
            </span>
            <b>{good}</b>
          </div>
          <div className="share-stat bad">
            <span className="share-stat-name">
              <i style={{ background: BAD }} />
              Novice + Competent
            </span>
            <b>{bad}</b>
          </div>
        </div>
      </div>
    </InsightCard>
  );
}

/** Responses grouped by a demographic field, each bar split by understanding level, with totals. */
export function StackedLevelCard({
  id,
  title,
  subtitle,
  field,
  list,
  mapRef,
  limit = DEFAULT_VISIBLE,
}: {
  id: string;
  title: string;
  subtitle: string;
  field: DemoField;
  list: ResponseRecord[];
  mapRef: MapRef;
  limit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const all = groupByLevel(list, field);
  const rows = expanded ? all : all.slice(0, limit);
  const height = rows.length * 46 + 74;

  return (
    <InsightCard title={title} subtitle={subtitle} onCopy={() => copyCardImage({ title, subtitle, canvas: mapRef.current[id] ?? null })}>
      <div className="chart-box" style={{ height }}>
        <ChartCanvas id={id} config={stackedConfig(rows)} canvasMapRef={mapRef} />
      </div>
      <ViewAll total={all.length} limit={limit} expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
    </InsightCard>
  );
}

/** Simple frequency bars for a demographic field: top N, expandable to everything. */
export function TopListCard({
  id,
  title,
  subtitle,
  field,
  list,
  mapRef,
  color,
  limit = DEFAULT_VISIBLE,
}: {
  id: string;
  title: string;
  subtitle: string;
  field: DemoField;
  list: ResponseRecord[];
  mapRef: MapRef;
  color: string;
  limit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const all = tally(list, field);
  const rows = expanded ? all : all.slice(0, limit);
  const height = rows.length * 42 + 44;

  return (
    <InsightCard title={title} subtitle={subtitle} onCopy={() => copyCardImage({ title, subtitle, canvas: mapRef.current[id] ?? null })}>
      <div className="chart-box" style={{ height }}>
        <ChartCanvas id={id} config={singleBarConfig(rows, color)} canvasMapRef={mapRef} />
      </div>
      <ViewAll total={all.length} limit={limit} expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
    </InsightCard>
  );
}