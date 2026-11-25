import type { ModelFactsLabel, ModelFactsPerformanceEntry } from '@oci/shared-types';
import { describe, expect, it } from 'vitest';
import en from '../i18n/messages/en/models.json';
import fr from '../i18n/messages/fr/models.json';
import { performanceLayout, standingKey } from './model-facts-performance';

let n = 0;
function entry(standing: ModelFactsPerformanceEntry['standing']): ModelFactsPerformanceEntry {
  n += 1;
  return {
    submissionId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    taskSlug: 'idrid-grading',
    taskName: 'Retinopathy grading',
    taskKind: 'GRADING',
    primaryMetricLabel: 'Quadratic-weighted kappa',
    primaryMetricValue: 0.8,
    coverage: 1,
    datasetSlug: 'idrid',
    datasetVersion: '1.0.0',
    routeSlug: standing === 'NOT_ATTRIBUTED' ? null : 'oci-predictions-scoring',
    routeVersion: standing === 'NOT_ATTRIBUTED' ? null : '1.0.0',
    routeReviewStatus: standing === 'PUBLISHED' ? 'APPROVED' : null,
    standing,
    evaluatedAt: '2026-11-20T10:00:00.000Z',
  };
}

function perf(
  entries: ModelFactsPerformanceEntry[],
  provisional: ModelFactsPerformanceEntry[],
): ModelFactsLabel['validationAndPerformance'] {
  return { entries, provisional, subgroupAvailable: false, subgroupNote: 'n/a' };
}

describe('performanceLayout (#587)', () => {
  it('is empty when nothing is linked', () => {
    expect(performanceLayout(perf([], []))).toEqual({ kind: 'empty' });
  });

  it('keeps published and provisional results apart', () => {
    const published = entry('PUBLISHED');
    const underReview = entry('PROVISIONAL');
    const legacy = entry('NOT_ATTRIBUTED');
    expect(performanceLayout(perf([published], [underReview, legacy]))).toEqual({
      kind: 'results',
      published: [published],
      provisional: [underReview, legacy],
    });
  });

  it('shows provisional results with no published one: LEGACY results from before #583', () => {
    const legacy = entry('NOT_ATTRIBUTED');
    const layout = performanceLayout(perf([], [legacy]));
    expect(layout).toEqual({ kind: 'results', published: [], provisional: [legacy] });
  });
});

describe('standingKey (#587)', () => {
  it.each([
    ['PUBLISHED', 'published'],
    ['PROVISIONAL', 'provisional'],
    ['NOT_ATTRIBUTED', 'notAttributed'],
  ] as const)('names %s with a message both languages define', (standing, key) => {
    expect(standingKey(standing)).toBe(key);
    expect(new Map(Object.entries(en.facts.standing)).get(key)).toBeTruthy();
    expect(new Map(Object.entries(fr.facts.standing)).get(key)).toBeTruthy();
  });

  it('labels an unattributed result as provisional, never as published', () => {
    expect(en.facts.standing.notAttributed).toBe('Provisional (no method version recorded)');
    expect(fr.facts.standing.notAttributed).toMatch(/^Provisoire/);
  });
});
