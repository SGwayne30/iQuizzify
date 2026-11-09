import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Assessment, ResponseRecord, CustomField, Question, AnswerRecord } from './types';
import { fmtDate } from './utils';

function pct(r: ResponseRecord): number {
  return r.maxScore > 0 ? Math.round((r.totalScore / r.maxScore) * 100) : 0;
}

/** Human-readable answer for one question, used in the Excel export. */
function answerLabel(q: Question, a: AnswerRecord | undefined): string {
  if (!a) return '';
  switch (q.type) {
    case 'checkbox':
      return (a.selectedIndexes || []).map((i) => q.options[i]).filter(Boolean).join('; ');
    case 'paragraph':
    case 'shortAnswer':
      return a.textAnswer || '';
    case 'date':
      return a.dateAnswer || '';
    case 'time':
      return a.timeAnswer || '';
    case 'fileUpload':
      return a.fileAnswer?.name || '';
    case 'linearScale':
    case 'rating':
      return a.selectedIndex >= 0 ? String(a.selectedIndex) : '';
    case 'mcqGrid':
    case 'checkboxGrid':
      return (q.rows || [])
        .map((row, ri) => {
          const idx = q.type === 'mcqGrid' ? (a.gridAnswers?.[ri] === undefined ? [] : [a.gridAnswers[ri]]) : a.gridAnswersMulti?.[ri] || [];
          return `${row}: ${idx.map((i) => q.options[i]).filter(Boolean).join(', ')}`;
        })
        .join(' | ');
    default:
      return a.selectedIndex >= 0 ? q.options[a.selectedIndex] || '' : '';
  }
}

const isKeyed = (q: Question) =>
  q.type === 'checkbox' ? !!q.correctIndexes && q.correctIndexes.length > 0 : ['mcq', 'yesNo', 'dropdown', undefined].includes(q.type) && q.correctIndex >= 0;

/**
 * Excel workbook (.xlsx) with three sheets: every student's result with their answers,
 * a summary (including a per-class breakdown), and a question-by-question analysis.
 */
export async function exportXLSX(a: Assessment, list: ResponseRecord[], customFields: CustomField[] = []) {
  const XLSX = await import('xlsx');
  const keyed = a.questions.filter(isKeyed);

  // --- Sheet 1: results ----------------------------------------------------
  const resultRows = list.map((r) => {
    const answers = new Map(r.answers.map((x) => [x.questionId, x]));
    const row: Record<string, string | number> = {
      'Submitted At': fmtDate(r.submittedAt),
      'Student Number': r.demographics.studentNumber || '',
      Name: r.demographics.name,
      Email: r.demographics.email,
      Gender: r.demographics.gender || '',
      Course: r.demographics.course || '',
      Subject: r.demographics.subject || '',
    };
    for (const cf of customFields) row[cf.label] = r.demographics.custom?.[cf.id] || '';
    row['Score'] = r.totalScore;
    row['Max Score'] = r.maxScore;
    row['Percent'] = pct(r);
    row['Correct'] = r.correctCount;
    row['Questions'] = r.totalQuestions;
    row['Tab Switches'] = r.tabSwitchCount ?? 0;
    a.questions.forEach((q, i) => {
      const ans = answers.get(q.id);
      const mark = isKeyed(q) && ans ? (ans.correct ? ' \u2713' : ' \u2717') : '';
      row[`Q${i + 1}. ${q.text.slice(0, 60)}`] = answerLabel(q, ans) + mark;
    });
    return row;
  });

  // --- Sheet 2: summary ----------------------------------------------------
  const percents = list.map(pct);
  const avg = percents.length ? Math.round(percents.reduce((x, y) => x + y, 0) / percents.length) : 0;
  const passRate = percents.length ? Math.round((percents.filter((p) => p >= 75).length / percents.length) * 100) : 0;
  const summary: (string | number)[][] = [
    ['Assessment', a.title],
    ['Access code', a.code],
    ['Topic', a.topic || ''],
    ['Generated', new Date().toLocaleString()],
    [],
    ['Responses', list.length],
    ['Average score (%)', avg],
    ['Highest score (%)', percents.length ? Math.max(...percents) : 0],
    ['Lowest score (%)', percents.length ? Math.min(...percents) : 0],
    ['Passing rate (75% and above)', `${passRate}%`],
  ];
  const groupTable = (title: string, pick: (r: ResponseRecord) => string) => {
    const groups = new Map<string, number[]>();
    for (const r of list) {
      const key = pick(r) || '(not set)';
      groups.set(key, [...(groups.get(key) ?? []), pct(r)]);
    }
    if (groups.size === 0 || (groups.size === 1 && groups.has('(not set)'))) return;
    summary.push([], [title, 'Students', 'Average (%)', 'Highest (%)', 'Lowest (%)']);
    [...groups.entries()]
      .sort((x, y) => x[0].localeCompare(y[0]))
      .forEach(([name, ps]) =>
        summary.push([name, ps.length, Math.round(ps.reduce((x, y) => x + y, 0) / ps.length), Math.max(...ps), Math.min(...ps)])
      );
  };
  groupTable('Course', (r) => r.demographics.course || '');
  groupTable('Subject', (r) => r.demographics.subject || '');

  // --- Sheet 3: question analysis -----------------------------------------
  const analysis = a.questions.map((q, i) => {
    const answered = list.map((r) => r.answers.find((x) => x.questionId === q.id)).filter((x): x is AnswerRecord => !!x);
    const correct = answered.filter((x) => x.correct === true).length;
    return {
      '#': i + 1,
      Question: q.text,
      Type: q.type || 'mcq',
      Answered: answered.length,
      ...(isKeyed(q)
        ? { Correct: correct, 'Correct (%)': answered.length ? Math.round((correct / answered.length) * 100) : 0 }
        : { Correct: '\u2014', 'Correct (%)': '\u2014' }),
    };
  });

  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.json_to_sheet(resultRows);
  ws1['!cols'] = Object.keys(resultRows[0] ?? {}).map((k) => ({ wch: Math.min(Math.max(k.length + 2, 12), 36) }));
  ws1['!freeze'] = { xSplit: 0, ySplit: 1 } as never;
  XLSX.utils.book_append_sheet(wb, ws1, 'Results');
  const ws2 = XLSX.utils.aoa_to_sheet(summary);
  ws2['!cols'] = [{ wch: 32 }, { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Summary');
  const ws3 = XLSX.utils.json_to_sheet(analysis);
  ws3['!cols'] = [{ wch: 5 }, { wch: 60 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws3, 'Question analysis');
  void keyed;
  XLSX.writeFile(wb, `${a.code}-results.xlsx`);
}

export function exportPDF(
  a: Assessment,
  list: ResponseRecord[],
  chartCanvases: { id: string; canvas: HTMLCanvasElement }[] | null,
  customFields: CustomField[] = []
) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFontSize(16);
  doc.text(`${a.title} — Response Summary`, 14, 18);
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(
    `Code: ${a.code}   |   Topic: ${a.topic || '—'}   |   Generated: ${new Date().toLocaleString()}`,
    14,
    25
  );

  const avgPct = list.length ? Math.round(list.reduce((s, r) => s + pct(r), 0) / list.length) : 0;
  doc.setFontSize(11);
  doc.setTextColor(20);
  doc.text(`Total responses: ${list.length}    Average understanding score: ${avgPct}%`, 14, 34);

  autoTable(doc, {
    startY: 40,
    head: [
      [
        'Submitted',
        'Student No.',
        'Name',
        'Email',
        'Gender',
        'Course',
        'Subject',
        'Sex',
        'Civil',
        'Age Range',
        'Locality',
        'Province',
        'Region',
        'Inst. Category',
        'Office/Institution',
        'Designation',
        'Sector',
        ...customFields.map((cf) => cf.label),
        'Score',
        '%',
        'Correct',
      ],
    ],
    body: list.map((r) => [
      fmtDate(r.submittedAt),
      r.demographics.studentNumber || '',
      r.demographics.name,
      r.demographics.email,
      r.demographics.gender,
      r.demographics.course || '',
      r.demographics.subject || '',
      r.demographics.sex,
      r.demographics.civilStatus,
      r.demographics.age,
      r.demographics.locality,
      r.demographics.province,
      r.demographics.region,
      r.demographics.category,
      r.demographics.org,
      r.demographics.position,
      r.demographics.sector,
      ...customFields.map((cf) => r.demographics.custom?.[cf.id] || ''),
      r.totalScore + ' pts',
      pct(r) + '%',
      r.correctCount + '/' + r.totalQuestions,
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [63, 133, 113] },
    margin: { left: 14, right: 14 },
  });

  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;

  if (chartCanvases && chartCanvases.length > 0) {
    // Landscape page is wider than tall, so lay charts out in a 3-column grid
    // to make better use of the extra horizontal space.
    const cols = 3;
    const margin = 14;
    const colW = (pageWidth - margin * 2) / cols;
    const rowH = 72;
    const bottomLimit = pageHeight - 16;

    if (y + rowH > bottomLimit) {
      doc.addPage();
      y = 16;
    }
    doc.setFontSize(12);
    doc.setTextColor(20);
    doc.text('Demographic & understanding breakdown', margin, y);
    y += 6;

    chartCanvases.forEach(({ canvas }, idx) => {
      const col = idx % cols;
      if (col === 0 && idx !== 0) {
        y += rowH;
      }
      if (y + rowH > bottomLimit) {
        doc.addPage();
        y = 16;
      }
      const x = margin + col * colW;
      try {
        const img = canvas.toDataURL('image/png', 1.0);
        doc.addImage(img, 'PNG', x, y, colW - 6, rowH - 10);
      } catch {
        // ignore
      }
    });
  }

  doc.save(`${a.code}-summary.pdf`);
}
