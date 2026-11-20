import { z } from 'zod';

/**
 * A predictions file, as a participant uploads it in the browser (#645).
 *
 * `POST /v2/evaluation/tasks/:slug/submissions` takes JSON. Someone who filled
 * in a spreadsheet has a CSV, so this module turns either into the request's
 * `predictions` array, and writes the CSV template a task hands out. Pure, no
 * I/O: the web's server action calls it, and the API can call the same code if
 * it ever accepts a file directly.
 *
 * WHAT THIS CHECKS, AND WHAT IT LEAVES TO THE API. Only that the file reads as
 * rows of one identifier and one whole-number label. Whether the identifiers
 * belong to the task, whether one appears twice and whether a label is inside
 * the task's range are the API's validation path's questions (it knows the
 * task); answering them here too would give two answers that can disagree.
 *
 * STRICT ON PURPOSE. Nothing is guessed and nothing is dropped silently: a row
 * with an empty label, a third column with something in it, or a label written
 * `2.0` is reported with its line number instead of being skipped or rounded. A
 * file that scores differently from what its author believes they sent is worse
 * than one that is refused with a reason.
 *
 * Lives in its own module, not in `index.ts`, because the barrel imports the row
 * schema from here: a module the barrel re-exports cannot import the barrel.
 */

/** Most rows one submission may carry. Same cap as the API's request schema. */
export const MAX_PREDICTION_ROWS = 100_000;

/** Longest item identifier the API accepts. */
export const MAX_ITEM_ID_LENGTH = 200;

/**
 * Static ceiling on a label. The task's own range (`0..numClasses-1`) is
 * narrower and is enforced by the API, which knows the task.
 */
export const MAX_PREDICTION_LABEL = 1000;

/** One prediction, in the shape the submissions endpoint takes. */
export const PredictionRowSchema = z.object({
  imageId: z.string().min(1).max(MAX_ITEM_ID_LENGTH),
  grade: z.number().int().min(0).max(MAX_PREDICTION_LABEL),
});
export type PredictionRow = z.infer<typeof PredictionRowSchema>;

/** Header of the CSV form, in order. */
export const PREDICTIONS_CSV_HEADER = ['item_id', 'label'] as const;

/**
 * Separators a CSV may use. A semicolon is what a spreadsheet writes when the
 * regional settings use a comma as the decimal mark (French, German, Spanish…),
 * so refusing it would refuse most files saved in those locales.
 */
export const PREDICTIONS_CSV_DELIMITERS = [',', ';'] as const;
export type PredictionsCsvDelimiter = (typeof PREDICTIONS_CSV_DELIMITERS)[number];

/** How many problems one parse reports in full. The total is always given. */
export const MAX_REPORTED_FILE_ISSUES = 20;

export type PredictionsFileFormat = 'CSV' | 'JSON';

export interface PredictionsFileIssue {
  /** 1-based line in the file, or `null` when the problem is not on one line. */
  line: number | null;
  message: string;
}

export type PredictionsFileParseResult =
  | { ok: true; format: PredictionsFileFormat; predictions: PredictionRow[] }
  | {
      ok: false;
      format: PredictionsFileFormat;
      /** The first `MAX_REPORTED_FILE_ISSUES` problems, in file order. */
      issues: PredictionsFileIssue[];
      /** Every problem found, including those not listed. */
      issueCount: number;
    };

/** Collects problems, keeping the first few and counting all of them. */
class IssueLog {
  readonly issues: PredictionsFileIssue[] = [];
  count = 0;

  add(line: number | null, message: string): void {
    this.count += 1;
    if (this.issues.length < MAX_REPORTED_FILE_ISSUES) this.issues.push({ line, message });
  }
}

/**
 * Read a predictions file. The content decides the format: JSON starts with
 * `{` or `[`, anything else is read as CSV. The file name is not consulted, so
 * a CSV saved as `.txt` works and a mislabelled file fails on what it contains.
 */
export function parsePredictionsFile(text: string): PredictionsFileParseResult {
  // A byte-order mark is what a spreadsheet writes for "CSV UTF-8". It is not
  // part of the first header cell.
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const first = body.trimStart().charAt(0);
  return first === '{' || first === '[' ? parseJson(body) : parseCsv(body);
}

// ---- JSON -------------------------------------------------------------------

/** A row in a JSON file. Unknown keys are refused, not stripped. */
const JsonRowSchema = PredictionRowSchema.strict();

function parseJson(text: string): PredictionsFileParseResult {
  const log = new IssueLog();
  const fail = (): PredictionsFileParseResult => ({
    ok: false,
    format: 'JSON',
    issues: log.issues,
    issueCount: log.count,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    log.add(
      null,
      `The file is not valid JSON: ${err instanceof Error ? err.message : 'parse error'}`,
    );
    return fail();
  }

  // Either the request body (`{ "predictions": [...] }`) or the array alone.
  const rows = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && 'predictions' in parsed
      ? (parsed as { predictions: unknown }).predictions
      : undefined;
  if (!Array.isArray(rows)) {
    log.add(
      null,
      'Expected an object with a "predictions" array, or the array on its own: [{ "imageId": "…", "grade": 0 }].',
    );
    return fail();
  }
  if (rows.length === 0) {
    log.add(null, 'The "predictions" array is empty.');
    return fail();
  }
  if (rows.length > MAX_PREDICTION_ROWS) {
    log.add(
      null,
      `The file has ${rows.length} predictions; the most one submission may carry is ${MAX_PREDICTION_ROWS}.`,
    );
    return fail();
  }

  const predictions: PredictionRow[] = [];
  rows.forEach((row, index) => {
    const result = JsonRowSchema.safeParse(row);
    if (result.success) {
      predictions.push(result.data);
      return;
    }
    const issue = result.error.issues[0];
    const where = issue && issue.path.length > 0 ? `.${issue.path.join('.')}` : '';
    log.add(null, `predictions[${index}]${where}: ${issue?.message ?? 'not a valid prediction'}`);
  });

  return log.count > 0 ? fail() : { ok: true, format: 'JSON', predictions };
}

// ---- CSV --------------------------------------------------------------------

interface CsvRecord {
  /** 1-based line the record starts on. */
  line: number;
  fields: string[];
}

/**
 * Split CSV text into records (RFC 4180: quoted fields, `""` for a quote inside
 * one, CRLF / LF / CR line ends). Returns the records and any structural
 * problem; a problem ends the scan, because after an unbalanced quote every
 * later boundary is a guess.
 */
function splitCsv(
  text: string,
  delimiter: PredictionsCsvDelimiter,
): { records: CsvRecord[]; error: PredictionsFileIssue | null } {
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let line = 1;
  let recordLine = 1;
  /** `open` inside quotes; `closed` just after the closing quote. */
  let quote: 'none' | 'open' | 'closed' = 'none';
  let quoteLine = 1;

  const endField = () => {
    // Spaces around an unquoted value are a spreadsheet artefact; inside quotes
    // they were written on purpose and are kept.
    fields.push(quote === 'closed' ? field : field.trim());
    field = '';
    quote = 'none';
  };
  const endRecord = () => {
    endField();
    records.push({ line: recordLine, fields });
    fields = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);

    if (quote === 'open') {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') {
          field += '"';
          i += 1;
        } else {
          quote = 'closed';
        }
      } else {
        if (ch === '\n') line += 1;
        field += ch;
      }
      continue;
    }

    if (ch === delimiter) {
      endField();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text.charAt(i + 1) === '\n') i += 1;
      endRecord();
      line += 1;
      recordLine = line;
    } else if (quote === 'closed') {
      if (ch !== ' ' && ch !== '\t') {
        return {
          records,
          error: {
            line,
            message:
              'Text follows a closing quote. A value is either quoted as a whole or not at all, and a quote inside a quoted value is written twice ("").',
          },
        };
      }
    } else if (ch === '"' && field.trim() === '') {
      field = '';
      quote = 'open';
      quoteLine = line;
    } else {
      field += ch;
    }
  }

  if (quote === 'open') {
    return {
      records,
      error: { line: quoteLine, message: 'A quoted value is opened here and never closed.' },
    };
  }
  // A last line without a line end is still a record.
  if (field !== '' || fields.length > 0 || quote === 'closed') endRecord();

  return { records, error: null };
}

const isBlank = (record: CsvRecord) => record.fields.every((f) => f === '');

/** Trailing empty cells are what a stray spreadsheet column leaves behind. */
function withoutTrailingEmpty(fields: readonly string[]): string[] {
  let end = fields.length;
  while (end > 0 && fields[end - 1] === '') end -= 1;
  return fields.slice(0, end);
}

/**
 * The separator a file uses. An explicit `sep=` first line wins (spreadsheets
 * read it, and some tools write it); otherwise the header decides, and a header
 * that is exactly `item_id;label` is the only way a semicolon is chosen.
 */
function detectDelimiter(text: string): {
  delimiter: PredictionsCsvDelimiter;
  /** Text with a `sep=` line blanked, so line numbers still match the file. */
  body: string;
} {
  const firstBreak = text.search(/\r|\n/);
  const firstLine = (firstBreak === -1 ? text : text.slice(0, firstBreak)).trim();

  const declared = /^sep=(.)$/i.exec(firstLine)?.[1];
  if (declared === ',' || declared === ';') {
    return { delimiter: declared, body: firstBreak === -1 ? '' : text.slice(firstBreak) };
  }

  const header = text.split(/\r|\n/).find((l) => l.trim() !== '') ?? '';
  return { delimiter: header.includes(';') && !header.includes(',') ? ';' : ',', body: text };
}

function parseCsv(text: string): PredictionsFileParseResult {
  const log = new IssueLog();
  const fail = (): PredictionsFileParseResult => ({
    ok: false,
    format: 'CSV',
    issues: log.issues,
    issueCount: log.count,
  });

  const { delimiter, body } = detectDelimiter(text);
  const { records, error } = splitCsv(body, delimiter);
  if (error) {
    log.add(error.line, error.message);
    return fail();
  }

  const rows = records.filter((r) => !isBlank(r));
  const header = rows[0];
  if (!header) {
    log.add(null, 'The file is empty.');
    return fail();
  }

  const expected = PREDICTIONS_CSV_HEADER.join(',');
  const headerCells = withoutTrailingEmpty(header.fields).map((c) => c.toLowerCase());
  if (headerCells.join(',') !== expected) {
    log.add(
      header.line,
      headerCells.includes('score')
        ? `A score column is not accepted: the tasks scored today take one whole-number label per item. The first line must be exactly ${expected}.`
        : `The first line must be the header ${expected} (comma or semicolon separated). Found: ${header.fields.join(delimiter)}`,
    );
    return fail();
  }

  const data = rows.slice(1);
  if (data.length === 0) {
    log.add(null, 'The file has a header and no predictions.');
    return fail();
  }
  if (data.length > MAX_PREDICTION_ROWS) {
    log.add(
      null,
      `The file has ${data.length} predictions; the most one submission may carry is ${MAX_PREDICTION_ROWS}.`,
    );
    return fail();
  }

  const predictions: PredictionRow[] = [];
  for (const record of data) {
    const cells = withoutTrailingEmpty(record.fields);
    const itemId = cells[0] ?? '';
    const label = cells[1] ?? '';

    if (cells.length > PREDICTIONS_CSV_HEADER.length) {
      log.add(record.line, `Expected two values (item_id and label), found ${cells.length}.`);
    } else if (itemId === '') {
      log.add(record.line, 'The item_id is empty.');
    } else if (itemId.length > MAX_ITEM_ID_LENGTH) {
      log.add(record.line, `The item_id is longer than ${MAX_ITEM_ID_LENGTH} characters.`);
    } else if (label === '') {
      log.add(
        record.line,
        `No label for "${itemId}". Fill it in, or delete the line to leave the item out.`,
      );
    } else if (!/^\d+$/.test(label)) {
      log.add(
        record.line,
        `The label for "${itemId}" must be a whole number such as 0 or 1. Found: ${label}`,
      );
    } else if (Number(label) > MAX_PREDICTION_LABEL) {
      log.add(record.line, `The label for "${itemId}" is larger than ${MAX_PREDICTION_LABEL}.`);
    } else {
      predictions.push({ imageId: itemId, grade: Number(label) });
    }
  }

  return log.count > 0 ? fail() : { ok: true, format: 'CSV', predictions };
}

// ---- Template ---------------------------------------------------------------

/** Quote a cell when leaving it bare would change how it reads back. */
function csvCell(value: string, delimiter: PredictionsCsvDelimiter): string {
  const needsQuotes =
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r') ||
    value !== value.trim();
  return needsQuotes ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * The CSV a participant fills in: the header, then one line per item with the
 * label left empty. Reading it back with `parsePredictionsFile` before any
 * label is typed reports every line, which is the intended prompt.
 *
 * Identifiers are written exactly as the task holds them. They are NOT
 * prefixed to stop a spreadsheet reading one as a formula: that would change
 * the identifier, and a changed identifier scores as an unknown item.
 */
export function predictionsTemplateCsv(
  itemIds: readonly string[],
  delimiter: PredictionsCsvDelimiter = ',',
): string {
  const lines = [
    PREDICTIONS_CSV_HEADER.join(delimiter),
    ...itemIds.map((id) => `${csvCell(id, delimiter)}${delimiter}`),
  ];
  // CRLF, per RFC 4180 and what spreadsheets expect.
  return `${lines.join('\r\n')}\r\n`;
}
