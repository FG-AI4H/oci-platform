import { PlatformGroupSchema, type PlatformGroup } from '@oci/shared-types';
import { z } from 'zod';

/**
 * The roster: one line per person, read from a CSV with the header
 * `email,given_name,family_name,groups`. Groups are separated by `;` and
 * must be names from `PlatformGroupSchema`.
 *
 * Everything here is pure. The whole file is checked and every problem is
 * collected before the caller is allowed to make a single directory call, so
 * a typo on line 20 cannot leave nineteen accounts half made.
 */

export interface RosterEntry {
  /** Line of the CSV the entry starts on (1-based; the header is line 1). */
  line: number;
  /** Lower-cased and trimmed. */
  email: string;
  givenName: string;
  familyName: string;
  /** Deduplicated, in the order written. May be empty. */
  groups: PlatformGroup[];
}

export interface RosterIssue {
  line: number;
  message: string;
}

export type RosterResult =
  | { ok: true; entries: RosterEntry[] }
  | { ok: false; issues: RosterIssue[] };

export const ROSTER_COLUMNS = ['email', 'given_name', 'family_name', 'groups'] as const;
type RosterColumn = (typeof ROSTER_COLUMNS)[number];

const EXPECTED_HEADER = ROSTER_COLUMNS.join(',');
const VALID_GROUPS: readonly string[] = PlatformGroupSchema.options;
const MAX_NAME_LENGTH = 100;

const EmailSchema = z.email().max(254);

interface CsvRecord {
  line: number;
  cells: string[];
}

class CsvSyntaxError extends Error {
  constructor(
    readonly line: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Spreadsheet programs set to a French locale export "CSV" with `;` between
 * the columns. The header has no quoting to worry about, so it is enough to
 * look at which of the two characters it contains.
 */
function detectDelimiter(text: string): ',' | ';' {
  const header = text.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  return header.includes(';') && !header.includes(',') ? ';' : ',';
}

/** RFC 4180 reader: quoted cells, doubled quotes, CRLF or LF line ends. */
function parseDelimited(text: string, delimiter: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  let quoteLine = 1;

  const endRecord = (): void => {
    cells.push(cell);
    records.push({ line: recordLine, cells });
    cells = [];
    cell = '';
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        if (ch === '\n') line += 1;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === '') {
      quoted = true;
      quoteLine = line;
    } else if (ch === delimiter) {
      cells.push(cell);
      cell = '';
    } else if (ch === '\n') {
      endRecord();
      line += 1;
      recordLine = line;
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  if (quoted) {
    throw new CsvSyntaxError(quoteLine, 'a quoted value is never closed');
  }
  if (cell !== '' || cells.length > 0) endRecord();
  return records;
}

function isBlank(record: CsvRecord): boolean {
  return record.cells.every((c) => c.trim() === '');
}

function readHeader(record: CsvRecord): Map<RosterColumn, number> | null {
  const names = record.cells.map((c) => c.trim().toLowerCase());
  if (names.length !== ROSTER_COLUMNS.length) return null;
  const positions = new Map<RosterColumn, number>();
  for (const column of ROSTER_COLUMNS) {
    const at = names.indexOf(column);
    if (at === -1) return null;
    positions.set(column, at);
  }
  return positions;
}

function checkName(value: string, label: string): string | null {
  if (value === '') return `${label} is empty`;
  if (value.length > MAX_NAME_LENGTH)
    return `${label} is longer than ${MAX_NAME_LENGTH} characters`;
  if (/\p{Cc}/u.test(value)) return `${label} contains a control character`;
  return null;
}

/** Parse and validate a roster. Never throws on bad input: it returns every issue found. */
export function parseRoster(text: string): RosterResult {
  // A byte-order mark, which spreadsheet programs put in front of UTF-8 exports.
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delimiter = detectDelimiter(source);

  let records: CsvRecord[];
  try {
    records = parseDelimited(source, delimiter).filter((r) => !isBlank(r));
  } catch (err) {
    if (err instanceof CsvSyntaxError) {
      return { ok: false, issues: [{ line: err.line, message: err.message }] };
    }
    throw err;
  }

  const [headerRecord, ...rows] = records;
  if (!headerRecord) {
    return {
      ok: false,
      issues: [{ line: 1, message: `the file is empty; expected the header "${EXPECTED_HEADER}"` }],
    };
  }
  const header = readHeader(headerRecord);
  if (!header) {
    return {
      ok: false,
      issues: [
        {
          line: headerRecord.line,
          message: `the first line must be the header "${EXPECTED_HEADER}"`,
        },
      ],
    };
  }
  if (rows.length === 0) {
    return {
      ok: false,
      issues: [{ line: headerRecord.line, message: 'the roster has no one in it' }],
    };
  }

  const issues: RosterIssue[] = [];
  const entries: RosterEntry[] = [];
  const firstSeen = new Map<string, number>();

  for (const row of rows) {
    if (row.cells.length !== ROSTER_COLUMNS.length) {
      const hint =
        delimiter === ';'
          ? ' (this file separates columns with ";", so several groups must be quoted: "annotator;reviewer")'
          : '';
      issues.push({
        line: row.line,
        message: `expected ${ROSTER_COLUMNS.length} columns, found ${row.cells.length}${hint}`,
      });
      continue;
    }
    const read = (column: RosterColumn): string =>
      (row.cells[header.get(column) ?? -1] ?? '').trim();

    const rowIssues: string[] = [];

    const email = read('email').toLowerCase();
    if (!EmailSchema.safeParse(email).success) {
      rowIssues.push(email === '' ? 'email is empty' : `"${email}" is not an e-mail address`);
    } else {
      const earlier = firstSeen.get(email);
      if (earlier !== undefined) {
        rowIssues.push(`${email} is already on line ${earlier}`);
      } else {
        firstSeen.set(email, row.line);
      }
    }

    const givenName = read('given_name');
    const familyName = read('family_name');
    for (const problem of [
      checkName(givenName, 'given_name'),
      checkName(familyName, 'family_name'),
    ]) {
      if (problem) rowIssues.push(problem);
    }

    const groups: PlatformGroup[] = [];
    for (const raw of read('groups').split(';')) {
      const name = raw.trim();
      if (name === '') continue;
      const parsed = PlatformGroupSchema.safeParse(name);
      if (!parsed.success) {
        rowIssues.push(`unknown group "${name}" (valid groups: ${VALID_GROUPS.join(', ')})`);
      } else if (!groups.includes(parsed.data)) {
        groups.push(parsed.data);
      }
    }

    if (rowIssues.length > 0) {
      for (const message of rowIssues) issues.push({ line: row.line, message });
      continue;
    }
    entries.push({ line: row.line, email, givenName, familyName, groups });
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, entries };
}
