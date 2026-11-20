import { describe, expect, it } from 'vitest';
import { withoutHeldDistributions } from './dicom-hold.js';

const HELD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const hosted = (id: string) => `/v2/catalog/datasets/ct-demo/distributions/${id}/download`;

describe('withoutHeldDistributions', () => {
  const manifest = {
    name: 'CT demo',
    distribution: [
      { '@id': 'a.dcm', contentUrl: hosted(OTHER) },
      { '@id': 'held.dcm', sha256: 'ab'.repeat(32), contentUrl: hosted(HELD) },
      { '@id': 'upstream.zip', contentUrl: 'https://example.org/upstream.zip' },
      { '@id': 'no-url' },
    ],
    recordSet: [{ '@id': 'records' }],
  };

  it('removes the entry of a held file and nothing else', () => {
    const out = withoutHeldDistributions(manifest, new Set([HELD])) as typeof manifest;

    expect(out.distribution.map((d) => d['@id'])).toEqual(['a.dcm', 'upstream.zip', 'no-url']);
    expect(out.recordSet).toBe(manifest.recordSet);
    expect(JSON.stringify(out)).not.toContain('held.dcm');
  });

  it('does not change the manifest it was given', () => {
    withoutHeldDistributions(manifest, new Set([HELD]));
    expect(manifest.distribution).toHaveLength(4);
  });

  it('matches an absolute address and the prefixed property names', () => {
    const prefixed = {
      'sc:distribution': [
        { '@id': 'held.dcm', 'sc:contentUrl': `https://dev.example.org${hosted(HELD)}` },
      ],
    };
    expect(withoutHeldDistributions(prefixed, new Set([HELD]))).toEqual({ 'sc:distribution': [] });
  });

  it('returns the very same object when nothing is held or nothing matches', () => {
    expect(withoutHeldDistributions(manifest, new Set())).toBe(manifest);
    expect(
      withoutHeldDistributions(manifest, new Set(['cccccccc-cccc-4ccc-8ccc-cccccccccccc'])),
    ).toBe(manifest);
  });

  it('passes through what is not a manifest object', () => {
    for (const value of [null, undefined, 'text', 3, [manifest]]) {
      expect(withoutHeldDistributions(value, new Set([HELD]))).toBe(value);
    }
  });
});
