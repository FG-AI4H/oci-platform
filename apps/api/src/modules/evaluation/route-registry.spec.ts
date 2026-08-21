import { ConflictException } from '@nestjs/common';
import {
  DisclosureProfileSchema,
  EvaluationSubmissionResultSchema,
  OperationalEnvelopeSchema,
  ThreatModelSchema,
  allowedReviewTransitionsFrom,
  canReviewTransition,
  declarationsAreFrozen,
  type ThreatModel,
} from '@oci/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { attributionFor } from './route-registry.js';
import { RouteRegistryService } from './route-registry.service.js';

const THREAT: ThreatModel = {
  adversaries: [{ party: 'PLATFORM_OPERATOR', capability: 'reads all logs', defended: true }],
  assumptions: ['SGX attestation root is trusted'],
  outOfScope: ['a malicious data host'],
};

function ref(status: string) {
  return { version: '1.0.0', reviewStatus: status as never, route: { slug: 'oci-sealed' } };
}

describe('WP5 invariant 3 — a score never leaves the API without its route', () => {
  it('rejects a DTO carrying a score with no attribution', () => {
    const bad = {
      id: '11111111-1111-4111-8111-111111111111',
      methodName: 'm',
      status: 'SCORED',
      scores: {
        kind: 'GRADING',
        metrics: {
          qwk: 1,
          accuracy: 1,
          referableSensitivity: 1,
          referableSpecificity: 1,
          coverage: 1,
        },
      },
      attribution: null,
      createdAt: '2026-08-21T00:00:00.000Z',
    };
    const r = EvaluationSubmissionResultSchema.safeParse(bad);
    expect(r.success).toBe(false);
    if (!r.success) expect(JSON.stringify(r.error.issues)).toContain('invariant 3');
  });

  it('accepts an unscored row with no attribution', () => {
    const ok = {
      id: '11111111-1111-4111-8111-111111111111',
      methodName: 'm',
      status: 'PENDING',
      scores: null,
      attribution: null,
      createdAt: '2026-08-21T00:00:00.000Z',
    };
    expect(EvaluationSubmissionResultSchema.safeParse(ok).success).toBe(true);
  });
});

describe('attributionFor — legacy rows are labelled, not backfilled or hidden', () => {
  const scores = { kind: 'GRADING' };

  it('labels a pre-registry row LEGACY rather than inventing a route', () => {
    const a = attributionFor({ scores, retractedAt: null, routeVersionRef: null });
    expect(a?.kind).toBe('LEGACY');
    if (a?.kind === 'LEGACY') expect(a.note).toContain('excluded from published reporting');
  });

  it('returns null when there is no score to attribute', () => {
    expect(attributionFor({ scores: null, retractedAt: null, routeVersionRef: null })).toBeNull();
  });

  it('marks an APPROVED route published (invariant 2)', () => {
    const a = attributionFor({ scores, retractedAt: null, routeVersionRef: ref('APPROVED') });
    expect(a).toMatchObject({ kind: 'ROUTED', routeSlug: 'oci-sealed', published: true });
  });

  it('marks DECLARED and UNDER_REVIEW provisional — produced, but not published', () => {
    for (const s of ['DECLARED', 'UNDER_REVIEW']) {
      const a = attributionFor({ scores, retractedAt: null, routeVersionRef: ref(s) });
      expect(a).toMatchObject({ kind: 'ROUTED', reviewStatus: s, published: false });
    }
  });

  it('surfaces the retraction stamp rather than dropping the row', () => {
    const when = new Date('2026-08-21T10:00:00.000Z');
    const a = attributionFor({ scores, retractedAt: when, routeVersionRef: ref('REJECTED') });
    expect(a).toMatchObject({ published: false, retractedAt: when.toISOString() });
  });
});

describe('WP5 invariant 4 — declarations freeze once review begins', () => {
  it('is editable only while DECLARED', () => {
    expect(declarationsAreFrozen('DECLARED')).toBe(false);
    expect(RouteRegistryService.declarationsEditable('DECLARED')).toBe(true);
    for (const s of ['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN'] as const) {
      expect(declarationsAreFrozen(s)).toBe(true);
      expect(RouteRegistryService.declarationsEditable(s)).toBe(false);
    }
  });

  it('permits only the published lifecycle moves', () => {
    expect(canReviewTransition('DECLARED', 'UNDER_REVIEW')).toBe(true);
    expect(canReviewTransition('UNDER_REVIEW', 'APPROVED')).toBe(true);
    // A version cannot jump review.
    expect(canReviewTransition('DECLARED', 'APPROVED')).toBe(false);
    // Terminal.
    expect(allowedReviewTransitionsFrom('REJECTED')).toEqual([]);
    expect(allowedReviewTransitionsFrom('WITHDRAWN')).toEqual([]);
  });
});

describe('WP5 invariant 6 — malformed declarations are rejected at the boundary', () => {
  it('refuses a threat model that names no out-of-scope boundary', () => {
    expect(ThreatModelSchema.safeParse({ ...THREAT, outOfScope: [] }).success).toBe(false);
  });

  it('refuses "reproducible: true" with no method', () => {
    const r = DisclosureProfileSchema.safeParse({
      observations: [{ party: 'DATA_HOST', observes: 'ciphertext only' }],
      trustAnchor: 'CRYPTOGRAPHIC',
      keyGovernance: 'host holds keys',
      reproducible: { value: true },
    });
    expect(r.success).toBe(false);
  });

  it('refuses an envelope with a non-positive runtime cap', () => {
    const r = OperationalEnvelopeSchema.safeParse({
      permittedOperations: ['add'],
      arithmeticPrecision: 'int8',
      maxRuntimeSec: 0,
      maxMemoryMb: 512,
    });
    expect(r.success).toBe(false);
  });
});

describe('WP5 invariant 5 — at most one reference route per mode', () => {
  it('refuses a second reference route for the same mode', async () => {
    const repo = {
      findRouteBySlug: vi.fn().mockResolvedValue(null),
      findReferenceRouteForMode: vi.fn().mockResolvedValue({ slug: 'oci-sealed' }),
      createRoute: vi.fn(),
    };
    const audit = { emitSync: vi.fn().mockResolvedValue({}) };
    const svc = new RouteRegistryService(repo as never, audit as never);

    await expect(
      svc.createRoute({
        slug: 'rival-sealed',
        name: 'Rival',
        mode: 'CONTAINER',
        isReference: true,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.createRoute).not.toHaveBeenCalled();
  });
});
