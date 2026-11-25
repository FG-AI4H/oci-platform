/** Characters a spreadsheet reads as the start of a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One CSV cell (RFC 4180), safe to open in a spreadsheet. Shared by the
 * audit export (#653) and the annotation export (#648).
 *
 * A cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage
 * return is prefixed with an apostrophe, so it is shown as text rather
 * than run as a formula (CSV injection). The apostrophe is part of the
 * value in the file; a program reading the file sees it.
 *
 * A cell holding a comma, a double quote or a line break is quoted, and
 * its double quotes are doubled.
 */
export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/**
 * Byte-order mark. A spreadsheet opening a CSV without it may read the
 * file in the system's legacy code page and garble accents; with it, the
 * file is read as UTF-8.
 */
export const UTF8_BOM = '﻿';
