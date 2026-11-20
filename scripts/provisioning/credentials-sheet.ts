/* eslint-disable security/detect-non-literal-fs-filename -- the sheet path is the operator's --credentials-out argument; assertSheetPathAllowed vets it before anything is written */
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
  statSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';

/**
 * The credentials sheet: a CSV with one line per temporary password issued,
 * for the operator to print or cut into slips. It is the only place a
 * password is written; nothing is printed to the terminal.
 *
 * The sheet must never land in a git working tree, where one `git add -A`
 * would publish it. `assertSheetPathAllowed` refuses such a path, and the
 * caller runs it before the first directory call.
 */

export class CredentialsSheetPathError extends Error {
  override readonly name = 'CredentialsSheetPathError';
}

export interface Credential {
  email: string;
  givenName: string;
  familyName: string;
  groups: readonly string[];
  temporaryPassword: string;
  /** `created`: a new account. `reset`: a new temporary password for an existing one. */
  reason: 'created' | 'reset';
}

const HEADER = [
  'email',
  'given_name',
  'family_name',
  'groups',
  'temporary_password',
  'sign_in_address',
  'issued_at',
  'reason',
] as const;

/**
 * Resolve symlinks in the part of the path that exists, so a link that
 * points into a repository is judged by where it really leads.
 */
function canonicalise(absolutePath: string): string {
  const missing: string[] = [];
  let current = absolutePath;
  while (!existsSync(current)) {
    // Present to lstat but not to stat: a link whose destination is missing.
    // Writing through it would create a file wherever it points.
    if (lstatSync(current, { throwIfNoEntry: false })) {
      throw new CredentialsSheetPathError(`${current} is a link that leads nowhere`);
    }
    const parent = path.dirname(current);
    if (parent === current) return absolutePath;
    missing.unshift(path.basename(current));
    current = parent;
  }
  return path.join(realpathSync(current), ...missing);
}

function isInside(candidate: string, directory: string): boolean {
  const relative = path.relative(directory, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** The nearest ancestor that holds a `.git` entry (a directory, or a file in a worktree). */
function enclosingRepository(directory: string): string | null {
  let current = directory;
  for (;;) {
    if (existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Refuse a sheet path that is inside this repository or inside any other git
 * working tree, that names a directory, or whose folder is missing or not
 * writable. Returns the canonical path to write to.
 *
 * @param repositoryRoot the checkout this script runs from; refused even if
 *   it has no `.git` entry (an exported tarball, for instance).
 */
export function assertSheetPathAllowed(absolutePath: string, repositoryRoot: string): string {
  const target = canonicalise(absolutePath);
  const folder = path.dirname(target);

  const ownRepository = canonicalise(repositoryRoot);
  if (isInside(target, ownRepository)) {
    throw new CredentialsSheetPathError(
      `${target} is inside the repository (${ownRepository}). The credentials sheet holds passwords: give a path outside it.`,
    );
  }
  const otherRepository = enclosingRepository(folder);
  if (otherRepository) {
    throw new CredentialsSheetPathError(
      `${target} is inside a git working tree (${otherRepository}). The credentials sheet holds passwords: give a path outside any repository.`,
    );
  }

  if (!existsSync(folder) || !statSync(folder).isDirectory()) {
    throw new CredentialsSheetPathError(`the folder ${folder} does not exist`);
  }
  if (existsSync(target) && statSync(target).isDirectory()) {
    throw new CredentialsSheetPathError(`${target} is a folder; give the path of a file`);
  }
  try {
    accessSync(existsSync(target) ? target : folder, constants.W_OK);
  } catch {
    throw new CredentialsSheetPathError(`${target} cannot be written to`);
  }
  return target;
}

/** Quote a value for CSV when it holds a comma, a quote or a line break. */
function quote(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * A CSV cell for text someone else may have typed. A value that a spreadsheet
 * would run as a formula (it starts with `=`, `+`, `-`, `@`, tab or carriage
 * return) gets a leading apostrophe.
 */
function cell(value: string): string {
  return quote(/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);
}

export class CredentialsSheet {
  private rows = 0;

  /**
   * @param target a path already vetted by `assertSheetPathAllowed`
   * @param signInAddress printed on every line so a slip is self-contained
   */
  constructor(
    private readonly target: string,
    private readonly signInAddress: string | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get path(): string {
    return this.target;
  }

  /** Lines added by this run. */
  get rowsWritten(): number {
    return this.rows;
  }

  /**
   * Append one line, creating the file (owner-only, with its header) on the
   * first call. Appending means a second run never erases the passwords an
   * earlier run issued, and writing line by line means a run that stops
   * half-way has still recorded every password it handed out.
   */
  append(credential: Credential): void {
    const line = [
      cell(credential.email),
      cell(credential.givenName),
      cell(credential.familyName),
      cell(credential.groups.join(';')),
      // Quoted if need be, but never given the apostrophe: the password must
      // read exactly as issued. Generated ones start with a letter.
      quote(credential.temporaryPassword),
      cell(this.signInAddress ?? ''),
      this.now().toISOString(),
      credential.reason,
    ];
    const fd = openSync(this.target, 'a', 0o600);
    try {
      if (fstatSync(fd).size === 0) writeSync(fd, `${HEADER.join(',')}\n`);
      writeSync(fd, `${line.join(',')}\n`);
    } finally {
      closeSync(fd);
    }
    this.rows += 1;
  }
}
