import { z } from 'zod';

/**
 * `EvaluationRoute` — a privacy-preserving evaluation solution (WP5, #412,
 * ADR-0018). Either the OCI reference implementation or a third-party
 * competitive entry.
 *
 * A route's claims live in three declarations, frozen per version so a review
 * outcome applies to exactly what was reviewed. These schemas are the write
 * boundary: a malformed declaration is rejected, never stored as loose JSON
 * (invariant 6).
 */

/** Parties that can observe anything during an evaluation. */
export const RoutePartySchema = z.enum([
  'DATA_HOST',
  'MODEL_DEVELOPER',
  'PLATFORM_OPERATOR',
  'ROUTE_PROVIDER',
]);
export type RouteParty = z.infer<typeof RoutePartySchema>;

/**
 * The adversary a version claims to defend against — and what it explicitly
 * does not. An empty `outOfScope` is itself a review finding: every real system
 * has boundaries, and declining to name them is a claim in its own right.
 */
export const ThreatModelSchema = z
  .object({
    adversaries: z
      .array(
        z
          .object({
            party: RoutePartySchema,
            capability: z.string().min(1).max(2000),
            defended: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(16),
    /** e.g. the hardness assumption, or the attestation root of trust. */
    assumptions: z.array(z.string().min(1).max(1000)).min(1).max(32),
    /** Explicit non-guarantees. Deliberately `min(1)`: see above. */
    outOfScope: z.array(z.string().min(1).max(1000)).min(1).max(32),
  })
  .strict();
export type ThreatModel = z.infer<typeof ThreatModelSchema>;

/** What each party observes, under which trust anchor, and whether it reproduces. */
export const DisclosureProfileSchema = z
  .object({
    observations: z
      .array(
        z
          .object({
            party: RoutePartySchema,
            observes: z.string().min(1).max(2000),
          })
          .strict(),
      )
      .min(1)
      .max(16),
    trustAnchor: z.enum(['CONTRACTUAL', 'HARDWARE_ATTESTATION', 'CRYPTOGRAPHIC']),
    /** Who holds decryption keys or attestation roots. */
    keyGovernance: z.string().min(1).max(2000),
    reproducible: z
      .object({
        value: z.boolean(),
        /** How it reproduces. Required when `value` is true. */
        method: z.string().max(2000).nullable().optional(),
      })
      .strict()
      .superRefine((r, ctx) => {
        if (r.value && !(r.method && r.method.length > 0)) {
          ctx.addIssue({
            code: 'custom',
            path: ['method'],
            message: 'method is required when reproducible.value is true',
          });
        }
      }),
  })
  .strict();
export type DisclosureProfile = z.infer<typeof DisclosureProfileSchema>;

/**
 * The operating limits a participant must design to. The runtime and memory
 * caps are **enforced by the sandbox**, not merely documented — a declared cap
 * the runner does not apply is a bug, not a nuance.
 */
export const OperationalEnvelopeSchema = z
  .object({
    permittedOperations: z.array(z.string().min(1).max(200)).min(1).max(64),
    arithmeticPrecision: z.string().min(1).max(200),
    maxRuntimeSec: z.number().int().positive().max(86_400),
    maxMemoryMb: z.number().int().positive().max(1_048_576),
    /** Architecture limits participants must design to. */
    modelConstraints: z.string().max(4000).nullable().optional(),
    /** Measured delta vs an unconstrained plaintext baseline. Null until measured. */
    fidelityGap: z
      .object({
        metric: z.string().min(1).max(200),
        delta: z.number(),
        measuredOn: z.string().min(1).max(200),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();
export type OperationalEnvelope = z.infer<typeof OperationalEnvelopeSchema>;

/**
 * Review lifecycle, as published in the conformance specification §6.
 * Only `APPROVED` may produce a published result.
 */
export const RouteReviewStatusSchema = z.enum([
  'DECLARED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
]);
export type RouteReviewStatus = z.infer<typeof RouteReviewStatusSchema>;

/** Statuses whose results are published rather than provisional (invariant 2). */
export const PUBLISHABLE_REVIEW_STATUSES: ReadonlyArray<RouteReviewStatus> = ['APPROVED'];

/** Statuses that retract results already produced (WP9). */
export const RETRACTING_REVIEW_STATUSES: ReadonlyArray<RouteReviewStatus> = [
  'REJECTED',
  'WITHDRAWN',
];

// Declarations are immutable once review has begun (invariant 4): a change means
// a new version. A Map keeps the lookup free of dynamic-key access.
const REVIEW_TRANSITIONS = new Map<RouteReviewStatus, ReadonlyArray<RouteReviewStatus>>([
  ['DECLARED', ['UNDER_REVIEW', 'WITHDRAWN']],
  ['UNDER_REVIEW', ['APPROVED', 'REJECTED', 'WITHDRAWN']],
  ['APPROVED', ['WITHDRAWN', 'REJECTED']],
  ['REJECTED', []],
  ['WITHDRAWN', []],
]);

export function allowedReviewTransitionsFrom(
  from: RouteReviewStatus,
): ReadonlyArray<RouteReviewStatus> {
  return REVIEW_TRANSITIONS.get(from) ?? [];
}

export function canReviewTransition(from: RouteReviewStatus, to: RouteReviewStatus): boolean {
  return allowedReviewTransitionsFrom(from).includes(to);
}

/** True once a version's declarations are frozen (invariant 4). */
export function declarationsAreFrozen(status: RouteReviewStatus): boolean {
  return status !== 'DECLARED';
}

// ---------------------------------------------------------------------------
// API shapes
// ---------------------------------------------------------------------------

export const CreateEvaluationRouteRequestSchema = z
  .object({
    slug: z
      .string()
      .min(3)
      .max(120)
      .regex(/^[a-z0-9-]+$/),
    name: z.string().min(1).max(200),
    /** Execution family. `ENCRYPTED` is Track B (WP8), open 2026-11-01. */
    mode: z.enum(['PREDICTIONS', 'CONTAINER', 'ENCRYPTED']),
    /** Null for the OCI reference implementation. */
    providerName: z.string().min(1).max(200).nullable().optional(),
    isReference: z.boolean().default(false),
  })
  .strict();
export type CreateEvaluationRouteRequest = z.infer<typeof CreateEvaluationRouteRequestSchema>;

export const CreateRouteVersionRequestSchema = z
  .object({
    version: z.string().regex(/^\d+\.\d+\.\d+$/, 'expected MAJOR.MINOR.PATCH'),
    threatModel: ThreatModelSchema,
    disclosureProfile: DisclosureProfileSchema,
    operationalEnvelope: OperationalEnvelopeSchema,
  })
  .strict();
export type CreateRouteVersionRequest = z.infer<typeof CreateRouteVersionRequestSchema>;

export const ReviewRouteVersionRequestSchema = z
  .object({
    status: RouteReviewStatusSchema,
    /** Reviewer-facing outcome text. Published alongside results per the spec. */
    reviewNotes: z.string().max(8000).nullable().optional(),
  })
  .strict();
export type ReviewRouteVersionRequest = z.infer<typeof ReviewRouteVersionRequestSchema>;

export const RouteVersionResponseSchema = z.object({
  id: z.string().uuid(),
  routeId: z.string().uuid(),
  version: z.string(),
  threatModel: ThreatModelSchema,
  disclosureProfile: DisclosureProfileSchema,
  operationalEnvelope: OperationalEnvelopeSchema,
  reviewStatus: RouteReviewStatusSchema,
  reviewedAt: z.string().nullable(),
  reviewNotes: z.string().nullable(),
  createdAt: z.string(),
});
export type RouteVersionResponse = z.infer<typeof RouteVersionResponseSchema>;

export const EvaluationRouteResponseSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  mode: z.string(),
  providerName: z.string().nullable(),
  isReference: z.boolean(),
  versions: z.array(RouteVersionResponseSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EvaluationRouteResponse = z.infer<typeof EvaluationRouteResponseSchema>;

/**
 * The route attribution carried alongside every score (invariant 3).
 *
 * `legacy` marks a result scored before the registry existed: those rows
 * genuinely have no route, and a backfill would assert a review that never
 * happened. They are labelled here rather than hidden or invented.
 */
export const ScoreAttributionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ROUTED'),
    routeSlug: z.string(),
    routeVersion: z.string(),
    reviewStatus: RouteReviewStatusSchema,
    /** False while the producing version is DECLARED or UNDER_REVIEW. */
    published: z.boolean(),
    retractedAt: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('LEGACY'),
    note: z.string(),
  }),
]);
export type ScoreAttribution = z.infer<typeof ScoreAttributionSchema>;

export const LEGACY_ATTRIBUTION_NOTE =
  'Scored before the evaluation-route registry existed (ADR-0018 / WP5). This result carries no route declaration and is excluded from published reporting.';
