import { ModelFactsPerformanceEntrySchema, type RouteReviewStatus } from '@oci/shared-types';
import { describe, expect, it, vi } from 'vitest';
import type {
  DatasetVersionRow,
  EvaluationRepository,
  LinkedSubmissionRow,
} from './evaluation.repository.js';
import { datasetVersionAt, modelCardPerformance, standingOf } from './model-card-evidence.js';
import { ModelCardEvidenceService } from './model-card-evidence.service.js';
import { attributionFor } from './route-registry.js';

/**
 * #587 — where each linked result stands on the Model Facts label. The rule is
 * `attributionFor`'s: only an APPROVED route version publishes. A LEGACY row
 * (no route version, which is every direct submission until #583) is listed as
 * not attributed and never as published.
 */

const GRADING_SCORES = {
  kind: 'GRADING',
  metrics: {
    qwk: 0.8123,
    accuracy: 0.9,
    referableSensitivity: 1,
    referableSpecificity: 0.5,
    coverage: 0.95,
  },
};

/** No positive case in the split: balanced accuracy is not estimable. */
const BINARY_NOT_ESTIMABLE = {
  kind: 'BINARY_DIAGNOSTIC',
  metrics: {
    truePositives: 0,
    falsePositives: 0,
    trueNegatives: 10,
    falseNegatives: 0,
    prevalence: null,
    sensitivity: null,
    specificity: null,
    positivePredictiveValue: null,
    negativePredictiveValue: null,
    accuracy: null,
    balancedAccuracy: null,
    auc: null,
    coverage: 1,
  },
};

let n = 0;
function row(
  over: Partial<LinkedSubmissionRow> & { review?: RouteReviewStatus | null } = {},
): LinkedSubmissionRow {
  const { review = null, ...rest } = over;
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    scores: GRADING_SCORES,
    createdAt: new Date('2026-11-20T10:00:00.000Z'),
    resultReceivedAt: null,
    retractedAt: null,
    routeVersionRef: review
      ? { version: '1.0.0', reviewStatus: review, route: { slug: 'oci-predictions-scoring' } }
      : null,
    task: {
      slug: 'idrid-grading',
      name: 'Retinopathy grading',
      datasetSlug: 'idrid',
      taskKind: 'GRADING',
    },
    ...rest,
  };
}

const VERSIONS: DatasetVersionRow[] = [
  { datasetSlug: 'idrid', version: '1.0.0', publishedAt: new Date('2026-06-01T00:00:00.000Z') },
  { datasetSlug: 'idrid', version: '1.1.0', publishedAt: new Date('2026-11-01T00:00:00.000Z') },
  { datasetSlug: 'idrid', version: '2.0.0', publishedAt: new Date('2026-11-22T00:00:00.000Z') },
  { datasetSlug: 'other', version: '9.9.9', publishedAt: new Date('2026-01-01T00:00:00.000Z') },
];

describe('standingOf (#587)', () => {
  it('a LEGACY row is NOT_ATTRIBUTED, never PUBLISHED', () => {
    const legacy = row();
    // What the publication rule says of it: LEGACY, excluded from published reporting.
    expect(attributionFor(legacy)).toMatchObject({ kind: 'LEGACY' });
    expect(standingOf(legacy)).toBe('NOT_ATTRIBUTED');
  });

  it.each<[RouteReviewStatus, string]>([
    ['APPROVED', 'PUBLISHED'],
    ['DECLARED', 'PROVISIONAL'],
    ['UNDER_REVIEW', 'PROVISIONAL'],
    ['REJECTED', 'RETRACTED'],
    ['WITHDRAWN', 'RETRACTED'],
  ])('a result from a %s route version is %s', (review, standing) => {
    expect(standingOf(row({ review }))).toBe(standing);
  });

  it('a stamped retraction wins over an APPROVED status', () => {
    expect(standingOf(row({ review: 'APPROVED', retractedAt: new Date() }))).toBe('RETRACTED');
  });
});

describe('modelCardPerformance (#587)', () => {
  it('splits by standing and fills every field an entry shows', () => {
    const published = row({ review: 'APPROVED' });
    const provisional = row({ review: 'UNDER_REVIEW' });
    const legacy = row();
    const out = modelCardPerformance([published, provisional, legacy], VERSIONS);

    expect(out.retracted).toBe(0);
    expect(out.notEstimable).toBe(0);
    expect(out.entries.map((e) => [e.submissionId, e.standing])).toEqual([
      [published.id, 'PUBLISHED'],
      [provisional.id, 'PROVISIONAL'],
      [legacy.id, 'NOT_ATTRIBUTED'],
    ]);
    for (const e of out.entries) expect(ModelFactsPerformanceEntrySchema.parse(e)).toEqual(e);

    expect(out.entries[0]).toEqual({
      submissionId: published.id,
      taskSlug: 'idrid-grading',
      taskName: 'Retinopathy grading',
      taskKind: 'GRADING',
      primaryMetricLabel: 'Quadratic-weighted kappa',
      primaryMetricValue: 0.8123,
      coverage: 0.95,
      datasetSlug: 'idrid',
      // Published 2026-11-01 is the latest at or before 2026-11-20; 2.0.0 came after.
      datasetVersion: '1.1.0',
      routeSlug: 'oci-predictions-scoring',
      routeVersion: '1.0.0',
      routeReviewStatus: 'APPROVED',
      standing: 'PUBLISHED',
      evaluatedAt: '2026-11-20T10:00:00.000Z',
    });
    // A LEGACY row names no route: there is none to name.
    expect(out.entries[2]).toMatchObject({
      routeSlug: null,
      routeVersion: null,
      routeReviewStatus: null,
    });
  });

  it('counts retracted results instead of listing them', () => {
    const out = modelCardPerformance(
      [row({ review: 'REJECTED' }), row({ review: 'WITHDRAWN' }), row({ review: 'APPROVED' })],
      VERSIONS,
    );
    expect(out.retracted).toBe(2);
    expect(out.entries.map((e) => e.standing)).toEqual(['PUBLISHED']);
  });

  it('counts a result with no estimable primary metric rather than printing it as 0', () => {
    const binary = row({
      review: 'APPROVED',
      scores: BINARY_NOT_ESTIMABLE,
      task: {
        slug: 'ptx',
        name: 'Pneumothorax',
        datasetSlug: 'ptx',
        taskKind: 'BINARY_DIAGNOSTIC',
      },
    });
    const corrupt = row({ scores: { not: 'a score' } });
    const out = modelCardPerformance([binary, corrupt], VERSIONS);
    expect(out.entries).toEqual([]);
    expect(out.notEstimable).toBe(2);
  });

  it('dates a sealed run by when its result arrived', () => {
    const out = modelCardPerformance(
      [
        row({
          review: 'DECLARED',
          createdAt: new Date('2026-11-21T00:00:00.000Z'),
          resultReceivedAt: new Date('2026-11-23T00:00:00.000Z'),
        }),
      ],
      VERSIONS,
    );
    expect(out.entries[0]?.evaluatedAt).toBe('2026-11-23T00:00:00.000Z');
    expect(out.entries[0]?.datasetVersion).toBe('2.0.0');
  });
});

describe('datasetVersionAt (#587)', () => {
  it('takes the latest version published at or before the moment, for that dataset only', () => {
    expect(datasetVersionAt(VERSIONS, 'idrid', new Date('2026-11-01T00:00:00.000Z'))).toBe('1.1.0');
    expect(datasetVersionAt(VERSIONS, 'idrid', new Date('2026-07-01T00:00:00.000Z'))).toBe('1.0.0');
  });

  it('is null before the first version, or for a dataset not in the catalogue', () => {
    expect(datasetVersionAt(VERSIONS, 'idrid', new Date('2026-01-01T00:00:00.000Z'))).toBeNull();
    expect(datasetVersionAt(VERSIONS, 'missing', new Date())).toBeNull();
  });
});

describe('ModelCardEvidenceService (#587)', () => {
  it('reads the linked rows and the versions of their datasets, once each', async () => {
    const repo = {
      findScoredSubmissionsForModelCard: vi
        .fn()
        .mockResolvedValue([row({ review: 'APPROVED' }), row()]),
      findDatasetVersions: vi.fn().mockResolvedValue(VERSIONS),
    };
    const svc = new ModelCardEvidenceService(repo as unknown as EvaluationRepository);

    const out = await svc.performanceFor('card-id');

    expect(repo.findScoredSubmissionsForModelCard).toHaveBeenCalledWith('card-id');
    expect(repo.findDatasetVersions).toHaveBeenCalledWith(['idrid']);
    expect(out.entries.map((e) => e.standing)).toEqual(['PUBLISHED', 'NOT_ATTRIBUTED']);
  });
});
