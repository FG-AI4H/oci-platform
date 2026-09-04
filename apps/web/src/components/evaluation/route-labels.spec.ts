import { describe, expect, it } from 'vitest';
import { describeAttribution } from './attribution';
import {
  asRouteMode,
  attributionForVersion,
  describeMode,
  describeProvider,
  formatMemory,
  formatRuntime,
  latestVersion,
  sortVersionsLatestFirst,
} from './route-labels';

describe('describeMode', () => {
  it('gives each execution family a plain-language label', () => {
    expect(describeMode('PREDICTIONS')).toBe('Predictions file scored on the platform');
    expect(describeMode('CONTAINER')).toBe('Sealed container run next to the data');
    expect(describeMode('ENCRYPTED')).toBe('Computation on encrypted values');
  });

  it('falls back to the raw word for an unknown mode', () => {
    expect(asRouteMode('SOMETHING_NEW')).toBeNull();
    expect(describeMode('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });
});

describe('describeProvider', () => {
  it('names the reference implementation regardless of providerName', () => {
    expect(describeProvider({ providerName: null, isReference: true })).toBe(
      'Reference implementation',
    );
    expect(describeProvider({ providerName: 'Acme', isReference: true })).toBe(
      'Reference implementation',
    );
  });

  it('otherwise uses the provider name', () => {
    expect(describeProvider({ providerName: 'Acme Labs', isReference: false })).toBe('Acme Labs');
    expect(describeProvider({ providerName: null, isReference: false })).toBe('Provider not named');
  });
});

describe('attributionForVersion', () => {
  it('reads as published only for APPROVED, matching the task page vocabulary', () => {
    const approved = attributionForVersion('r', { version: '1.0.0', reviewStatus: 'APPROVED' });
    expect(approved).toEqual({
      kind: 'ROUTED',
      routeSlug: 'r',
      routeVersion: '1.0.0',
      reviewStatus: 'APPROVED',
      published: true,
      retractedAt: null,
    });
    expect(describeAttribution(approved).label).toBe('published');

    for (const reviewStatus of ['DECLARED', 'UNDER_REVIEW'] as const) {
      const a = attributionForVersion('r', { version: '1.0.0', reviewStatus });
      expect(a.published).toBe(false);
      expect(describeAttribution(a).label).toBe('provisional');
    }
    for (const reviewStatus of ['REJECTED', 'WITHDRAWN'] as const) {
      const a = attributionForVersion('r', { version: '1.0.0', reviewStatus });
      expect(a.published).toBe(false);
      expect(describeAttribution(a).label).toBe('withdrawn');
    }
  });
});

describe('sortVersionsLatestFirst', () => {
  it('orders by MAJOR.MINOR.PATCH numerically, not lexically', () => {
    const sorted = sortVersionsLatestFirst([
      { version: '1.2.0' },
      { version: '1.10.0' },
      { version: '2.0.0' },
      { version: '1.9.3' },
    ]);
    expect(sorted.map((v) => v.version)).toEqual(['2.0.0', '1.10.0', '1.9.3', '1.2.0']);
  });

  it('keeps malformed versions after the well-formed ones, in API order', () => {
    const sorted = sortVersionsLatestFirst([
      { version: 'draft' },
      { version: '1.0.0' },
      { version: 'beta' },
    ]);
    expect(sorted.map((v) => v.version)).toEqual(['1.0.0', 'draft', 'beta']);
  });

  it('does not mutate its input and returns null for no versions', () => {
    const input = [{ version: '1.0.0' }, { version: '1.1.0' }];
    sortVersionsLatestFirst(input);
    expect(input.map((v) => v.version)).toEqual(['1.0.0', '1.1.0']);
    expect(latestVersion(input)?.version).toBe('1.1.0');
    expect(latestVersion([])).toBeNull();
  });
});

describe('formatRuntime', () => {
  it('renders seconds as hours and minutes', () => {
    expect(formatRuntime(45)).toBe('45 s');
    expect(formatRuntime(60)).toBe('1 min');
    expect(formatRuntime(90)).toBe('1 min 30 s');
    expect(formatRuntime(3600)).toBe('1 h');
    expect(formatRuntime(5400)).toBe('1 h 30 min');
    expect(formatRuntime(86_400)).toBe('24 h');
  });
});

describe('formatMemory', () => {
  it('stays in MiB below 1024 and switches to GiB from 1024', () => {
    expect(formatMemory(512)).toBe('512 MiB');
    expect(formatMemory(1023)).toBe('1,023 MiB');
    expect(formatMemory(1024)).toBe('1 GiB');
    expect(formatMemory(1536)).toBe('1.5 GiB');
    expect(formatMemory(16384)).toBe('16 GiB');
  });
});
