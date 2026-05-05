import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../src/index.js';

/**
 * Validates every Croissant manifest under `apps/api/scripts/fixtures/`
 * against the layered Croissant 1.1 + RAI + BIOCroissant schema. Keeps
 * the seed fixtures honest as the validator + BIOCroissant draft evolve
 * — a breaking BIOCroissant change should fail this test before the
 * change merges, not silently corrupt the seeded catalog.
 */

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../apps/api/scripts/fixtures',
);

describe('seed fixtures', () => {
  it('idrid.croissant.json validates as Croissant 1.1 + RAI + BIOCroissant', () => {
    const m = JSON.parse(readFileSync(path.join(fixturesDir, 'idrid.croissant.json'), 'utf8'));
    const r = validate(m);
    if (!r.ok) {
      throw new Error(`IDRiD fixture invalid:\n${JSON.stringify(r.issues, null, 2)}`);
    }
    expect(r.conformance).toBe('croissant-1.1');
    expect(r.hasRai).toBe(true);
    expect(r.hasBioCroissant).toBe(true);
  });
});
