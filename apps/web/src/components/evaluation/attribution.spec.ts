import { describe, expect, it } from 'vitest';
import { LEGACY_ATTRIBUTION_NOTE } from '@oci/shared-types';
import type { EvaluationSubmissionResult, ScoreAttribution } from '@oci/shared-types';
import {
  describeAttribution,
  isPublishedResult,
  PROVISIONAL_DESCRIPTION,
  rankSubmissions,
  RETRACTED_DESCRIPTION,
} from './attribution';

type Routed = Extract<ScoreAttribution, { kind: 'ROUTED' }>;

function routed(overrides: Partial<Routed> = {}): Routed {
  return {
    kind: 'ROUTED',
    routeSlug: 'idrid-qwk',
    routeVersion: '1.0.0',
    reviewStatus: 'APPROVED',
    published: true,
    retractedAt: null,
    ...overrides,
  };
}

const legacy: ScoreAttribution = { kind: 'LEGACY', note: LEGACY_ATTRIBUTION_NOTE };

const scores: EvaluationSubmissionResult['scores'] = {
  kind: 'GRADING',
  metrics: {
    qwk: 0.5,
    accuracy: 0.5,
    referableSensitivity: 0.5,
    referableSpecificity: 0.5,
    coverage: 1,
  },
};

let seq = 0;
function submission(
  attribution: ScoreAttribution | null,
  status: EvaluationSubmissionResult['status'] = 'SCORED',
): EvaluationSubmissionResult {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    methodName: `method-${seq}`,
    status,
    scores: status === 'SCORED' ? scores : null,
    attribution,
    createdAt: '2026-09-01T00:00:00.000Z',
  };
}

describe('describeAttribution', () => {
  it('retracted overrides every review status', () => {
    const d = describeAttribution(routed({ retractedAt: '2026-09-02T00:00:00.000Z' }));
    expect(d).toEqual({ label: 'retracted', tone: 'danger', description: RETRACTED_DESCRIPTION });
    // Even a still-APPROVED, still-`published` version reads as retracted.
    expect(
      describeAttribution(
        routed({ reviewStatus: 'APPROVED', published: true, retractedAt: '2026-09-02T00:00:00Z' }),
      ).label,
    ).toBe('retracted');
  });

  it('LEGACY is neutral and carries the API note verbatim', () => {
    expect(describeAttribution(legacy)).toEqual({
      label: 'legacy',
      tone: 'neutral',
      description: LEGACY_ATTRIBUTION_NOTE,
    });
  });

  it('APPROVED is published', () => {
    const d = describeAttribution(routed({ reviewStatus: 'APPROVED' }));
    expect(d.label).toBe('published');
    expect(d.tone).toBe('success');
    expect(d.description).not.toHaveLength(0);
  });

  it('DECLARED and UNDER_REVIEW are provisional', () => {
    for (const reviewStatus of ['DECLARED', 'UNDER_REVIEW'] as const) {
      expect(describeAttribution(routed({ reviewStatus, published: false }))).toEqual({
        label: 'provisional',
        tone: 'info',
        description: PROVISIONAL_DESCRIPTION,
      });
    }
  });

  it('REJECTED and WITHDRAWN are withdrawn', () => {
    for (const reviewStatus of ['REJECTED', 'WITHDRAWN'] as const) {
      const d = describeAttribution(routed({ reviewStatus, published: false }));
      expect(d.label).toBe('withdrawn');
      expect(d.tone).toBe('danger');
      expect(d.description).not.toHaveLength(0);
    }
  });
});

describe('isPublishedResult', () => {
  it('is true only for a routed, published, unretracted result', () => {
    expect(isPublishedResult(routed())).toBe(true);
    expect(isPublishedResult(routed({ published: false, reviewStatus: 'DECLARED' }))).toBe(false);
    expect(isPublishedResult(routed({ retractedAt: '2026-09-02T00:00:00.000Z' }))).toBe(false);
    expect(isPublishedResult(legacy)).toBe(false);
    expect(isPublishedResult(null)).toBe(false);
    expect(isPublishedResult(undefined)).toBe(false);
  });
});

describe('rankSubmissions', () => {
  it('numbers only published results, preserving API order', () => {
    const rows = [
      submission(routed({ reviewStatus: 'DECLARED', published: false })),
      submission(routed()),
      submission(legacy),
      submission(routed({ retractedAt: '2026-09-02T00:00:00.000Z' })),
      submission(routed({ routeVersion: '1.1.0' })),
      submission(null, 'PENDING'),
      submission(null, 'FAILED'),
    ];

    const ranked = rankSubmissions(rows);

    expect(ranked.map((r) => r.submission)).toEqual(rows);
    expect(ranked.map((r) => r.rank)).toEqual([null, 1, null, null, 2, null, null]);
  });

  it('LEGACY is not ranked', () => {
    expect(rankSubmissions([submission(legacy)]).map((r) => r.rank)).toEqual([null]);
  });

  it('DECLARED is not ranked', () => {
    const rows = [submission(routed({ reviewStatus: 'DECLARED', published: false }))];
    expect(rankSubmissions(rows).map((r) => r.rank)).toEqual([null]);
  });

  it('APPROVED is ranked', () => {
    expect(rankSubmissions([submission(routed())]).map((r) => r.rank)).toEqual([1]);
  });

  it('retracted is not ranked', () => {
    const rows = [submission(routed({ retractedAt: '2026-09-02T00:00:00.000Z' }))];
    expect(rankSubmissions(rows).map((r) => r.rank)).toEqual([null]);
  });

  it('returns an empty list for no submissions', () => {
    expect(rankSubmissions([])).toEqual([]);
  });
});
