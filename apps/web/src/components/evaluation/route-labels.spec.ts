import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { formattersFor } from '../../i18n/format';
import en from '../../i18n/messages/en';
import fr from '../../i18n/messages/fr';
import { describeAttribution } from './attribution';
import { evaluationI18n } from './i18n.testing';
import {
  asRouteMode,
  attributionForVersion,
  describeMode,
  describeProvider,
  formatDelta,
  formatMemory,
  formatRuntime,
  latestVersion,
  partyGlossary,
  partyLabel,
  shortMode,
  sortVersionsLatestFirst,
  trustAnchorLabel,
} from './route-labels';

const t = createTranslator({ locale: 'en', messages: en, namespace: 'EvaluationMethods' });
const tFr = createTranslator({ locale: 'fr', messages: fr, namespace: 'EvaluationMethods' });
const f = formattersFor('en');
const fFr = formattersFor('fr');
const evaluationT = evaluationI18n('en').t;

describe('describeMode', () => {
  it('gives each execution family a plain-language label', () => {
    expect(describeMode('PREDICTIONS', t)).toBe('Predictions file scored on the platform');
    expect(describeMode('CONTAINER', t)).toBe('Sealed container run next to the data');
    expect(describeMode('ENCRYPTED', t)).toBe('Computation on encrypted values');
    expect(shortMode('CONTAINER', t)).toBe('Sealed container');
  });

  it('falls back to the raw word for an unknown mode', () => {
    expect(asRouteMode('SOMETHING_NEW')).toBeNull();
    expect(describeMode('SOMETHING_NEW', t)).toBe('SOMETHING_NEW');
    expect(shortMode('SOMETHING_NEW', tFr)).toBe('SOMETHING_NEW');
  });

  it('words the modes in French (#654)', () => {
    expect(describeMode('CONTAINER', tFr)).toBe('Conteneur scellé exécuté à côté des données');
    expect(shortMode('ENCRYPTED', tFr)).toBe('Calcul chiffré');
  });
});

describe('describeProvider', () => {
  it('names the reference implementation regardless of providerName', () => {
    expect(describeProvider({ providerName: null, isReference: true }, t)).toBe(
      'Reference implementation',
    );
    expect(describeProvider({ providerName: 'Acme', isReference: true }, t)).toBe(
      'Reference implementation',
    );
    expect(describeProvider({ providerName: null, isReference: true }, tFr)).toBe(
      'Implémentation de référence',
    );
  });

  it('otherwise uses the provider name', () => {
    expect(describeProvider({ providerName: 'Acme Labs', isReference: false }, t)).toBe(
      'Acme Labs',
    );
    expect(describeProvider({ providerName: null, isReference: false }, t)).toBe(
      'Provider not named',
    );
  });
});

describe('parties and trust anchors', () => {
  it('names the four parties in display order, in both languages', () => {
    expect(partyGlossary(t).map((p) => p.label)).toEqual([
      'data host',
      'model developer',
      'platform operator',
      'method provider',
    ]);
    expect(partyLabel('ROUTE_PROVIDER', tFr)).toBe('fournisseur de la méthode');
    expect(trustAnchorLabel('CONTRACTUAL', t)).toBe('a contract');
    expect(trustAnchorLabel('CRYPTOGRAPHIC', tFr)).toBe('une hypothèse cryptographique');
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
    expect(describeAttribution(approved, evaluationT).label).toBe('published');

    for (const reviewStatus of ['DECLARED', 'UNDER_REVIEW'] as const) {
      const a = attributionForVersion('r', { version: '1.0.0', reviewStatus });
      expect(a.published).toBe(false);
      expect(describeAttribution(a, evaluationT).label).toBe('provisional');
    }
    for (const reviewStatus of ['REJECTED', 'WITHDRAWN'] as const) {
      const a = attributionForVersion('r', { version: '1.0.0', reviewStatus });
      expect(a.published).toBe(false);
      expect(describeAttribution(a, evaluationT).label).toBe('withdrawn');
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
    expect(formatMemory(512, t, f)).toBe('512 MiB');
    expect(formatMemory(1023, t, f)).toBe('1,023 MiB');
    expect(formatMemory(1024, t, f)).toBe('1 GiB');
    expect(formatMemory(1536, t, f)).toBe('1.5 GiB');
    expect(formatMemory(16384, t, f)).toBe('16 GiB');
  });

  it('uses French separators and units in French (#654)', () => {
    expect(formatMemory(1536, tFr, fFr)).toBe('1,5 Gio');
    expect(formatMemory(1023, tFr, fFr)).toBe('1 023 Mio');
  });
});

describe('formatDelta', () => {
  it('signs a gap and keeps up to four decimals', () => {
    expect(formatDelta(-0.012, f)).toBe('-0.012');
    expect(formatDelta(0.25, f)).toBe('+0.25');
    expect(formatDelta(0, f)).toBe('0');
    expect(formatDelta(0.25, fFr)).toBe('+0,25');
  });
});
