/* eslint-disable security/detect-non-literal-fs-filename -- the record path is the operator's --record-out argument; assertRecordPathAllowed vets it before anything is written */
import { accessSync, constants, existsSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { PurgeReport } from './purge-objects.js';

/**
 * The deletion record: a small JSON file that says what was found, what
 * was removed and what a fresh listing showed afterwards. It is the
 * evidence behind the written confirmation of deletion.
 *
 * It holds counts and sizes, never a key: an uploaded file's name is
 * part of its key, and the point of the deletion is that nothing derived
 * from the files stays behind.
 */

export class RecordPathError extends Error {
  override readonly name = 'RecordPathError';
}

export const PURGE_TOOL = 'purge-dataset-objects';
/** Bump when the record's shape or the deletion's behaviour changes. */
export const PURGE_TOOL_VERSION = '1';

export interface PurgeRecord extends PurgeReport {
  tool: typeof PURGE_TOOL;
  toolVersion: string;
  mode: 'dry-run' | 'execute';
  /** `complete` only when a fresh listing after the deletion was empty. */
  outcome: 'dry-run' | 'complete' | 'incomplete';
  bucket: string;
  prefix: string;
  /** Set when the run talked to something other than AWS (a local store). */
  endpoint: string | null;
  versioning: 'enabled' | 'suspended' | 'off';
  startedAt: string;
  finishedAt: string;
}

/** Resolve symlinks in the part of the path that exists. */
function canonicalise(absolutePath: string): string {
  const missing: string[] = [];
  let current = absolutePath;
  while (!existsSync(current)) {
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
 * Refuse a record path inside this repository or any other git working
 * tree (the record names a bucket and a dataset that was held under
 * restricted hosting; it is filed with the deletion, not committed),
 * one that names a folder, or one whose folder is missing or not
 * writable. An existing file is refused too: a record is never
 * overwritten. Returns the canonical path to write to.
 */
export function assertRecordPathAllowed(absolutePath: string, repositoryRoot: string): string {
  const target = canonicalise(absolutePath);
  const folder = path.dirname(target);

  const ownRepository = canonicalise(repositoryRoot);
  if (isInside(target, ownRepository)) {
    throw new RecordPathError(
      `${target} is inside the repository (${ownRepository}): give a path outside it`,
    );
  }
  const otherRepository = enclosingRepository(folder);
  if (otherRepository) {
    throw new RecordPathError(
      `${target} is inside a git working tree (${otherRepository}): give a path outside any repository`,
    );
  }
  if (!existsSync(folder) || !statSync(folder).isDirectory()) {
    throw new RecordPathError(`the folder ${folder} does not exist`);
  }
  if (existsSync(target)) {
    throw new RecordPathError(
      statSync(target).isDirectory()
        ? `${target} is a folder; give the path of a file`
        : `${target} already exists; a deletion record is never overwritten, choose a new name`,
    );
  }
  try {
    accessSync(folder, constants.W_OK);
  } catch {
    throw new RecordPathError(`${folder} cannot be written to`);
  }
  return target;
}

/** Write the record, owner-readable only, failing if the file appeared meanwhile. */
export function writeRecord(target: string, record: PurgeRecord): void {
  writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
}
