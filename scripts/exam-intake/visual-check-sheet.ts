import type { ArrivalRecord } from './arrival-record.js';

/**
 * The record sheet of the visual check: one line per exam, filled in by
 * the person who opened the exam and looked for text burned into the
 * pixels. No program reads pixels here, so this check is a person's,
 * and the sheet is what records it: who looked, when, and the result.
 *
 * The arrival check writes the sheet with the last four columns empty.
 * The uploader reads it back and refuses unless every exam of the
 * record has a line that says who, when and `clear`.
 */

export const SHEET_HEADER = [
  'exam',
  'exam_ref',
  'folders',
  'series',
  'images',
  'look_closely',
  'checked_by',
  'checked_on',
  'result',
  'notes',
] as const;

/** The two results a line may carry. Anything else is "not done". */
export const RESULT_CLEAR = 'clear';
export const RESULT_TEXT_FOUND = 'text-found';

function cell(value: string | number): string {
  const text = String(value);
  // A leading =, +, - or @ would be run as a formula by a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function buildSheet(record: Pick<ArrivalRecord, 'exams'>): string {
  const lines = [SHEET_HEADER.join(',')];
  for (const exam of record.exams) {
    lines.push(
      [
        exam.exam,
        exam.ref,
        exam.folders.join(' | '),
        exam.series.length,
        exam.series.reduce((sum, series) => sum + series.images + series.multiFrameObjects, 0),
        exam.lookClosely.join(' | '),
        '',
        '',
        '',
        '',
      ]
        .map(cell)
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * RFC 4180 fields of one CSV text: quoted fields, doubled quotes, CRLF
 * or LF. A spreadsheet set to French saves the sheet back with `;`
 * between fields; the header line says which of the two it is.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  // A spreadsheet may put a byte-order mark in front of the header.
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const headerLine = body.split(/\r?\n/, 1)[0] ?? '';
  const separator = headerLine.includes(';') && !headerLine.includes(',') ? ';' : ',';
  for (let i = 0; i < body.length; i += 1) {
    const char = body.charAt(i);
    if (quoted) {
      if (char === '"' && body.charAt(i + 1) === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === separator) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && body.charAt(i + 1) === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim() !== ''));
}

export interface VisualCheckVerdict {
  ok: boolean;
  /** One line per exam that keeps the sample from being uploaded. */
  issues: string[];
  /** Who looked and when, per exam, for the upload manifest. */
  checks: Array<{ exam: number; checkedBy: string; checkedOn: string }>;
}

/**
 * Hold a filled-in sheet against the record. Every exam of the record
 * must have exactly one line, with a name, a date and `clear`.
 */
export function readVisualCheck(
  sheetText: string,
  record: Pick<ArrivalRecord, 'exams'>,
): VisualCheckVerdict {
  const rows = parseCsv(sheetText);
  const header = (rows[0] ?? []).map((name) => name.trim().toLowerCase());
  const column = (name: (typeof SHEET_HEADER)[number]): number => header.indexOf(name);
  const issues: string[] = [];
  for (const name of ['exam_ref', 'checked_by', 'checked_on', 'result'] as const) {
    if (column(name) === -1) issues.push(`the sheet has no "${name}" column`);
  }
  if (issues.length > 0) return { ok: false, issues, checks: [] };

  const at = (cells: string[], name: (typeof SHEET_HEADER)[number]): string =>
    (cells.at(column(name)) ?? '').trim();
  const byRef = new Map<string, string[][]>();
  for (const cells of rows.slice(1)) {
    const ref = at(cells, 'exam_ref');
    byRef.set(ref, [...(byRef.get(ref) ?? []), cells]);
  }

  const checks: VisualCheckVerdict['checks'] = [];
  for (const exam of record.exams) {
    const lines = byRef.get(exam.ref) ?? [];
    const label = `exam ${exam.exam} (${exam.ref})`;
    const line = lines[0];
    if (!line) {
      issues.push(`${label}: no line on the sheet`);
    } else if (lines.length > 1) {
      issues.push(`${label}: ${lines.length} lines on the sheet, expected one`);
    } else {
      const checkedBy = at(line, 'checked_by');
      const checkedOn = at(line, 'checked_on');
      const result = at(line, 'result').toLowerCase();
      if (checkedBy === '') issues.push(`${label}: nobody is named as having looked at it`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(checkedOn)) {
        issues.push(`${label}: the date of the check is missing or not YYYY-MM-DD`);
      }
      if (result === RESULT_TEXT_FOUND) {
        issues.push(`${label}: text was found in the images; the exam may not be uploaded`);
      } else if (result !== RESULT_CLEAR) {
        issues.push(
          `${label}: the result is not "${RESULT_CLEAR}" (write "${RESULT_CLEAR}" or "${RESULT_TEXT_FOUND}")`,
        );
      }
      checks.push({ exam: exam.exam, checkedBy, checkedOn });
    }
  }
  const known = new Set(record.exams.map((exam) => exam.ref));
  for (const ref of byRef.keys()) {
    if (!known.has(ref)) issues.push(`a line of the sheet names an exam that is not in the record`);
  }
  return { ok: issues.length === 0, issues, checks: issues.length === 0 ? checks : [] };
}
