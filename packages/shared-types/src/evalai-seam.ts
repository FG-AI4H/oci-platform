import { z } from 'zod';

/**
 * EvalAI seam intake (WP4, #408, evalai-integration §3/§4).
 *
 * EvalAI owns the participant-facing surface; the OCI owns execution and
 * scoring. The organizer-run EvalAI remote worker forwards a submission here
 * instead of scoring it locally, so the ground truth stops living in the EvalAI
 * repo and never leaves the OCI.
 *
 * This is NOT the participant endpoint. The participant path allows anonymous
 * submissions; if it also accepted `externalSubmissionId`, any caller could
 * assert someone else's EvalAI submission id and the write-back would post
 * their result onto a stranger's row. Intake therefore has its own route behind
 * its own machine credential.
 */

/** Canonical IDRiD item id form: uppercase, three digits (`IDRiD_001`). */
export const SeamPredictionSchema = z
  .object({
    imageId: z.string().min(1).max(200),
    grade: z.number().int().min(0),
  })
  .strict();

export const SeamIntakeRequestSchema = z
  .object({
    taskSlug: z.string().min(1).max(200),
    predictions: z.array(SeamPredictionSchema).min(1).max(100_000),
    /** EvalAI's submission pk, carried through for reconciliation and write-back. */
    externalSubmissionId: z.string().min(1).max(200),
    /** EvalAI challenge pk — "493" for the GI-AI4H benchmarking challenge. */
    externalChallengeId: z.string().min(1).max(200),
    /**
     * Stable, opaque entrant identity — `participant_team:<pk>`.
     *
     * Keyed per TEAM, not per user, and that is load-bearing rather than
     * incidental: WP6's published cap is 3 scored submissions per week and 10
     * per task, EvalAI enforces its own native quotas per `participant_team`,
     * and a three-member team submitting under three user ids would otherwise
     * take 30. Keying on the same unit EvalAI uses keeps the two accounting
     * systems saying the same thing.
     *
     * Never a name or an email: the OCI derives a deterministic UUID from this
     * string and stores only that.
     */
    externalParticipantId: z.string().min(1).max(200),
    /**
     * EvalAI phase codename. Maps onto WP6 intent — `dev` is a format and
     * interface check that never touches ground truth and is unlimited; `test`
     * is scored and quota'd. Both 493 phases share one answer key, which is
     * exactly why dev must not score against it.
     */
    phaseCodename: z.string().min(1).max(200),
  })
  .strict();
export type SeamIntakeRequest = z.infer<typeof SeamIntakeRequestSchema>;

/**
 * Seam intake response. Two shapes in one flat object, because the two intents
 * genuinely differ:
 *
 *   - VALIDATION (dev) returns SYNCHRONOUSLY and creates no submission. It is an
 *     interface check: no ground truth is loaded, no quota is consumed, and
 *     there is nothing for a write-back to deliver later. The participant needs
 *     the answer now, so making them wait for an async result would be worse
 *     and also impossible — no row exists to write back against.
 *   - SCORED (test) returns 202 and carries no score. The result is delivered by
 *     the write-back and only by the write-back: two delivery paths for one
 *     result can disagree, and then someone has to arbitrate which is true.
 */
export const SeamIntakeResponseSchema = z
  .object({
    intent: z.enum(['VALIDATION', 'SCORED']),
    /** The OCI submission. Null for VALIDATION — no row is created. */
    ociSubmissionId: z.string().uuid().nullable(),
    /** Route attributed server-side. Null for VALIDATION (nothing was scored). */
    routeSlug: z.string().nullable(),
    routeVersion: z.string().nullable(),
    /**
     * Whether a result from this submission counts as published. False while the
     * attributed route version is not APPROVED — the result is real and stored,
     * but excluded from published reporting (WP5 invariant 2, ADR-0021). Always
     * false for VALIDATION, which produces no result at all.
     */
    published: z.boolean(),
    /** VALIDATION only: did the submission satisfy the interface contract? */
    validationOk: z.boolean().nullable(),
  })
  .strict();
export type SeamIntakeResponse = z.infer<typeof SeamIntakeResponseSchema>;

/** Phase codename -> WP6 intent. Unknown codenames are rejected, not guessed. */
export function intentForPhase(codename: string): 'VALIDATION' | 'SCORED' | null {
  const c = codename.trim().toLowerCase();
  if (c === 'dev' || c === 'validation') return 'VALIDATION';
  if (c === 'test' || c === 'final') return 'SCORED';
  return null;
}
