/* eslint-disable security/detect-non-literal-fs-filename -- the paths are the operator's own arguments, vetted here before anything is written */
import { randomUUID } from 'node:crypto';
import { existsSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assertRecordPathAllowed } from './purge-record.js';

/**
 * Where the intake scripts may write their records. Everything they
 * write describes a sample held under restricted hosting, so nothing
 * may land in a git working tree, where one `git add -A` would publish
 * it. The rule itself is the deletion record's (`assertRecordPathAllowed`).
 */

/** A file that must not exist yet. Returns the canonical path. */
export function newOutputFile(
  raw: string,
  workingDirectory: string,
  repositoryRoot: string,
): string {
  return assertRecordPathAllowed(path.resolve(workingDirectory, raw), repositoryRoot);
}

/**
 * A file that is rewritten as the work goes on (the upload state). It
 * may exist; its folder is held to the same rule as a new file's.
 */
export function rewritableOutputFile(
  raw: string,
  workingDirectory: string,
  repositoryRoot: string,
): string {
  const absolute = path.resolve(workingDirectory, raw);
  if (existsSync(absolute) && statSync(absolute).isFile()) {
    const probe = path.join(path.dirname(absolute), `.oci-probe-${randomUUID()}`);
    return path.join(
      path.dirname(assertRecordPathAllowed(probe, repositoryRoot)),
      path.basename(absolute),
    );
  }
  return assertRecordPathAllowed(absolute, repositoryRoot);
}

/** Write a new file, owner-readable only, failing if it appeared meanwhile. */
export function writeNewFile(target: string, content: string): void {
  writeFileSync(target, content, { mode: 0o600, flag: 'wx' });
}

/** Replace a file in one step, so that a crash never leaves half of it. */
export function replaceFile(target: string, content: string): void {
  const temporary = `${target}.${randomUUID()}.tmp`;
  writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' });
  renameSync(temporary, target);
}
