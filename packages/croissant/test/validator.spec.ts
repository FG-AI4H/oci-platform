import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validate } from '../src/index.js';

const dir = path.dirname(fileURLToPath(import.meta.url));

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(dir, 'fixtures', name), 'utf8'));
}

describe('validate', () => {
  it('rejects non-object input', () => {
    const r = validate('not an object');
    expect(r.ok).toBe(false);
    expect(r.conformance).toBe('unknown');
    expect(r.issues[0]?.code).toBe('validator.input.not_object');
  });

  it('flags unsupported conformance', () => {
    const r = validate({ '@context': {}, '@type': 'sc:Dataset' });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'validator.unsupported.conformance')).toBe(true);
  });

  it('accepts a minimal Croissant 1.0 manifest', () => {
    const r = validate(fixture('valid-croissant-1.0.json'));
    expect(r.ok, JSON.stringify(r.issues, null, 2)).toBe(true);
    expect(r.conformance).toBe('croissant-1.0');
    expect(r.hasRai).toBe(false);
    expect(r.hasBioCroissant).toBe(false);
  });

  it('accepts a 1.1 + RAI + BIOCroissant manifest', () => {
    const r = validate(fixture('valid-biocroissant-1.1.json'));
    expect(r.ok, JSON.stringify(r.issues, null, 2)).toBe(true);
    expect(r.conformance).toBe('croissant-1.1');
    expect(r.hasRai).toBe(true);
    expect(r.hasBioCroissant).toBe(true);
  });

  it('reports all missing required fields with JSON Pointers', () => {
    const r = validate(fixture('invalid-missing-required.json'));
    expect(r.ok).toBe(false);
    const codes = r.issues.map((i) => i.code).sort();
    // license / url / creator / datePublished must each surface.
    expect(codes).toContain('croissant10.missing.required.license');
    expect(codes).toContain('croissant10.missing.required.url');
    expect(codes).toContain('croissant10.missing.required.creator');
    expect(codes).toContain('croissant10.missing.required.datePublished');
    // All paths are RFC 6901 — start with `/` or are empty.
    for (const issue of r.issues) {
      expect(issue.path === '' || issue.path.startsWith('/')).toBe(true);
    }
  });

  it('rejects an invalid clinicalTrialId pattern', () => {
    const m = fixture('valid-biocroissant-1.1.json') as Record<string, unknown>;
    m['bio:clinicalTrialId'] = 'NOT-A-NCT-NUMBER';
    const r = validate(m);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code.startsWith('biocroissant.invalid'))).toBe(true);
  });

  it('rejects an unknown anonymizationLevel', () => {
    const m = fixture('valid-biocroissant-1.1.json') as Record<string, unknown>;
    m['bio:anonymizationLevel'] = 'OBFUSCATED';
    const r = validate(m);
    expect(r.ok).toBe(false);
    const codes = r.issues.map((i) => i.code);
    expect(codes.some((c) => c.startsWith('biocroissant.invalid'))).toBe(true);
  });

  it('accepts both prefixed and bare keys (normalizer)', () => {
    const m = fixture('valid-croissant-1.0.json') as Record<string, unknown>;
    // Re-encode `name` as `sc:name` — should still validate.
    m['sc:name'] = m['name'];
    delete m['name'];
    const r = validate(m);
    expect(r.ok, JSON.stringify(r.issues, null, 2)).toBe(true);
  });
});

describe('distribution @type spellings', () => {
  it('accepts cr:FileObject (the spec namespace) as well as sc:FileObject', () => {
    const m = fixture('valid-croissant-1.0.json') as {
      distribution: Array<Record<string, unknown>>;
    };
    for (const d of m.distribution) {
      if (d['@type'] === 'sc:FileObject') d['@type'] = 'cr:FileObject';
    }
    const r = validate(m);
    expect(r.ok, JSON.stringify(r.issues, null, 2)).toBe(true);
  });
});
