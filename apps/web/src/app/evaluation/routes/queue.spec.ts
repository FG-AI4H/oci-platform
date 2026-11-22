import { describe, expect, it } from 'vitest';
import type { EvaluationRouteResponse, RouteReviewStatus } from '@oci/shared-types';
import { awaitingReview } from './queue';

function route(slug: string, versions: Array<[string, RouteReviewStatus, string]>) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    slug,
    name: slug,
    mode: 'PREDICTIONS',
    providerName: null,
    isReference: false,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    versions: versions.map(([version, reviewStatus, createdAt]) => ({
      id: '22222222-2222-4222-8222-222222222222',
      routeId: '11111111-1111-4111-8111-111111111111',
      version,
      reviewStatus,
      createdAt,
      reviewedAt: null,
      reviewNotes: null,
    })),
  } as unknown as EvaluationRouteResponse;
}

describe('awaitingReview', () => {
  it('lists under-review then declared versions, oldest first, and nothing decided', () => {
    const out = awaitingReview([
      route('b', [
        ['1.0.0', 'APPROVED', '2026-11-01'],
        ['1.1.0', 'UNDER_REVIEW', '2026-11-05'],
        ['1.2.0', 'DECLARED', '2026-11-09'],
      ]),
      route('a', [
        ['0.1.0', 'UNDER_REVIEW', '2026-11-02'],
        ['0.2.0', 'REJECTED', '2026-11-03'],
        ['0.3.0', 'WITHDRAWN', '2026-11-04'],
        ['0.4.0', 'DECLARED', '2026-11-06'],
      ]),
    ]);
    expect(out.underReview.map((v) => `${v.route.slug}@${v.version.version}`)).toEqual([
      'a@0.1.0',
      'b@1.1.0',
    ]);
    expect(out.declared.map((v) => `${v.route.slug}@${v.version.version}`)).toEqual([
      'a@0.4.0',
      'b@1.2.0',
    ]);
  });

  it('is empty when nothing waits', () => {
    expect(awaitingReview([])).toEqual({ underReview: [], declared: [] });
  });
});
