/**
 * Minimal comma-separated reader and writer (RFC 4180: quoted fields, `""`
 * for a quote inside one, CRLF or LF line ends). Enough for the NIH metadata
 * file, a label file and the small files this profile writes.
 */

export class CsvError extends Error {}

/** Parse into rows of cells. Blank lines are dropped; cells are not trimmed. */
export function parseCsv(text: string): string[][] {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let line = 1;

  const endRow = () => {
    row.push(cell);
    cell = '';
    if (row.some((c) => c !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < body.length; i += 1) {
    const ch = body.charAt(i);
    if (inQuotes) {
      if (ch === '"' && body.charAt(i + 1) === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        if (ch === '\n') line += 1;
        cell += ch;
      }
    } else if (ch === '"' && cell === '') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body.charAt(i + 1) === '\n') i += 1;
      endRow();
      line += 1;
    } else {
      cell += ch;
    }
  }
  if (inQuotes) throw new CsvError(`A quoted value is never closed (near line ${line}).`);
  if (cell !== '' || row.length > 0) endRow();
  return rows;
}

function cellText(value: string): string {
  return /[",\r\n]/.test(value) || value !== value.trim()
    ? `"${value.replaceAll('"', '""')}"`
    : value;
}

/** Write rows with LF line ends and a final newline. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return `${rows.map((r) => r.map(cellText).join(',')).join('\n')}\n`;
}

/**
 * Rows as records keyed by header cell. Header names are matched exactly
 * after trimming; `required` names the columns the caller cannot do without,
 * and a missing one is reported together with what the file does have.
 */
export function parseCsvRecords(
  text: string,
  required: readonly string[],
  what: string,
): Map<string, string>[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) throw new CsvError(`${what}: the file is empty.`);
  const names = header.map((h) => h.trim());
  const missing = required.filter((r) => !names.includes(r));
  if (missing.length > 0) {
    throw new CsvError(
      `${what}: column(s) not found: ${missing.join(', ')}. The file has: ${names.filter((n) => n !== '').join(', ')}.`,
    );
  }
  return rows.map((cells) => {
    const record = new Map<string, string>();
    names.forEach((name, index) => {
      if (name !== '') record.set(name, (cells.at(index) ?? '').trim());
    });
    return record;
  });
}
