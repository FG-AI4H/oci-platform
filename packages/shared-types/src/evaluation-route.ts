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

/**
 * Review outcomes that decide whether a version's results count. Each is
 * recorded with a rationale, which is published with the decision
 * (ADR-0021). Beginning a review (`UNDER_REVIEW`) decides nothing, so its
 * note stays optional.
 */
export const REVIEW_STATUSES_REQUIRING_RATIONALE: ReadonlyArray<RouteReviewStatus> = [
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
];

export function reviewNeedsRationale(to: RouteReviewStatus): boolean {
  return REVIEW_STATUSES_REQUIRING_RATIONALE.includes(to);
}

/**
 * Path segments under `/evaluation/routes/` that the web app uses for its own
 * pages (the review queue). A route with one of these slugs could not be
 * reached, so it is refused at registration.
 */
export const RESERVED_ROUTE_SLUGS: ReadonlyArray<string> = ['reviews'];

// ---------------------------------------------------------------------------
// API shapes
// ---------------------------------------------------------------------------

export const CreateEvaluationRouteRequestSchema = z
  .object({
    slug: z
      .string()
      .min(3)
      .max(120)
      .regex(/^[a-z0-9-]+$/)
      .refine((slug) => !RESERVED_ROUTE_SLUGS.includes(slug), 'this slug is reserved'),
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
    /**
     * The rationale, published with the decision (ADR-0021). Required for
     * the statuses in `REVIEW_STATUSES_REQUIRING_RATIONALE`; the service
     * refuses a blank one with a 400. It replaces the version's previous
     * rationale.
     */
    reviewNotes: z.string().max(8000).nullable().optional(),
  })
  .strict();
export type ReviewRouteVersionRequest = z.infer<typeof ReviewRouteVersionRequestSchema>;

/**
 * Why the caller may not record a review outcome on a version: they hold no
 * reviewer role, or they registered the route or declared the version
 * (review is in pairs).
 */
export const RouteReviewBarSchema = z.enum([
  'NOT_A_REVIEWER',
  'SUBMITTED_BY_YOU',
  'DECLARED_BY_YOU',
]);
export type RouteReviewBar = z.infer<typeof RouteReviewBarSchema>;

/**
 * `GET /v2/evaluation/routes/:slug/permissions` — what the signed-in caller
 * may do on a route, computed by the same rules the write endpoints apply,
 * so the browser shows only the actions the API would accept. It says
 * nothing about anyone but the caller.
 */
export const RoutePermissionsResponseSchema = z.object({
  slug: z.string(),
  /** True when the caller registered the route. */
  isSubmitter: z.boolean(),
  /** The route's submitter, or `admin`. */
  canDeclareVersion: z.boolean(),
  versions: z.array(
    z.object({
      version: z.string(),
      reviewStatus: RouteReviewStatusSchema,
      /** The statuses the caller may move this version to now. */
      allowedTransitions: z.array(RouteReviewStatusSchema),
      /**
       * Why the caller may not review this version, when a review step is
       * still open on it and they are barred from it. Null otherwise.
       */
      reviewBar: RouteReviewBarSchema.nullable(),
    }),
  ),
});
export type RoutePermissionsResponse = z.infer<typeof RoutePermissionsResponseSchema>;

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

/**
 * The note carried by a LEGACY attribution. Since #583 every new submission
 * is pinned to a method version, so only results scored before that carry it.
 */
export const LEGACY_ATTRIBUTION_NOTE =
  'Result from before method versions were recorded. No version of the evaluation method is attached to it, so it is excluded from published reporting.';

/**
 * `code` of the 409 that refuses a scored submission when no evaluation
 * method version can be pinned to it (#583). Every new submission records the
 * version that serves it, so a submission with none is refused rather than
 * scored as LEGACY.
 */
export const NO_METHOD_VERSION_CODE = 'NO_METHOD_VERSION';

/**
 * Why no version could be pinned:
 *   - `NO_VERSION`: no reference method, or no version of it, is registered
 *     for the submission's mode;
 *   - `VERSION_CLOSED`: the version that serves the mode is REJECTED or
 *     WITHDRAWN, so it cannot produce new results until a new version is
 *     declared.
 */
export const NoMethodVersionReasonSchema = z.enum(['NO_VERSION', 'VERSION_CLOSED']);
export type NoMethodVersionReason = z.infer<typeof NoMethodVersionReasonSchema>;

/**
 * The 409 body. Nothing was written and no quota was used. `message` is
 * English for API callers; a page words the refusal from `code` and `reason`.
 */
export const NoMethodVersionRefusalSchema = z.object({
  statusCode: z.literal(409),
  code: z.literal(NO_METHOD_VERSION_CODE),
  reason: NoMethodVersionReasonSchema,
  message: z.string(),
});
export type NoMethodVersionRefusal = z.infer<typeof NoMethodVersionRefusalSchema>;
