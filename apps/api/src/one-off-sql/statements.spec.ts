import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * #739 — the statements an operator may run with the one-off runner, and
 * their manifest, agree. Reviewed statements are code: this is what a
 * pull request adding one must keep true.
 */
const DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../apps/migrate/statements',
);
const TYPES = ['uuid', 'slug', 'reference'];

interface Entry {
  file: string;
  writes: boolean;
  runbook?: string;
  params?: Record<string, string>;
}
const manifest = JSON.parse(readFileSync(path.join(DIR, 'statements.json'), 'utf8')) as {
  statements: Record<string, Entry>;
};
const entries = Object.entries(manifest.statements);

describe('one-off statements and their manifest', () => {
  it('lists every SQL file of the folder, and only those', () => {
    const files = readdirSync(DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    expect(entries.map(([, e]) => e.file).sort()).toEqual(files);
  });

  it.each(entries)(
    '%s: declares exactly the placeholders its file uses, with known types',
    (_name, entry) => {
      const sql = readFileSync(path.join(DIR, entry.file), 'utf8');
      const used = [
        ...new Set([...sql.matchAll(/__([A-Z][A-Z0-9_]*)__/g)].map((m) => m[1])),
      ].sort();
      expect(Object.keys(entry.params ?? {}).sort()).toEqual(used);
      for (const type of Object.values(entry.params ?? {})) expect(TYPES).toContain(type);
    },
  );

  it.each(entries)(
    '%s: names a runbook that exists, and has no transaction control',
    (_name, entry) => {
      expect(entry.runbook).toBeTruthy();
      expect(() =>
        readFileSync(path.join(DIR, '../../..', entry.runbook ?? ''), 'utf8'),
      ).not.toThrow();
      const code = readFileSync(path.join(DIR, entry.file), 'utf8').replace(/^\s*--[^\n]*$/gm, '');
      // The runner's own check (apps/migrate/run-statement.mjs), on a file
      // of a few kilobytes; the optional group cannot blow up on it.
      expect(code).not.toMatch(
        // eslint-disable-next-line security/detect-unsafe-regex
        /\b(COMMIT|ROLLBACK|SAVEPOINT|ABORT|START\s+TRANSACTION|PREPARE\s+TRANSACTION)\b|^\s*(BEGIN|END)(\s+(WORK|TRANSACTION))?\s*;/im,
      );
    },
  );

  it('marks as writing every statement that writes', () => {
    for (const [name, entry] of entries) {
      const code = readFileSync(path.join(DIR, entry.file), 'utf8').replace(/--[^\n]*/g, '');
      const writes = /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/i.test(code);
      // A statement that writes but says it reads would fail in its read-only
      // transaction; say what it does in the manifest instead.
      if (writes) expect(entry.writes, name).toBe(true);
    }
  });
});
