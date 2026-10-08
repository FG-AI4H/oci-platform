/**
 * Scored-submission quotas (WP6) — pure helpers, no NestJS / Prisma deps (same
 * shape as `scoring.ts` and `sealed-run.ts`).
 *
 * Two limits per participant per task, defaulting to 3 per week and 10 in
 * total. The weekly one paces the challenge; the total one is the real
 * anti-overfitting control, because every scored submission against hidden
 * ground truth is one query against that ground truth, and enough queries
 * reconstruct it.
 *
 * BOTH ARE CONFIGURABLE per environment, because the right number is a
 * challenge-design decision rather than a platform constant: it depends on the
 * size of the hidden set and how much of it a determined entrant could
 * reconstruct within the allowance. The defaults are what the platform
 * publishes when nothing says otherwise; they are not a claim that 10 is
 * correct for every task.
 *
 * The limits are threaded through as parameters rather than read from `process.env`
 * in here, so these stay pure functions and every refusal message is generated
 * from the limit that was actually enforced — a message quoting a different
 * number than the check used is the specific failure this shape prevents.
 *
 * WINDOW SEMANTICS — implemented: **calendar week, ISO-8601, starting Monday
 * 00:00:00 UTC.**
 *
 * The alternative considered and rejected was a rolling 7-day window. Both are
 * enforceable and both have a computable reset instant, so the decision came
 * down to which reset a participant can predict without asking:
 *
 *   - Calendar week: one instant, the same for every participant, readable off
 *     a calendar. "Resets Monday 00:00 UTC" needs no support email.
 *   - Rolling 7 days: the reset is the timestamp of the participant's own
 *     oldest in-window submission plus seven days, so it differs per
 *     participant, drifts every week, and yields three different reset instants
 *     for three used slots. Accurate, and exactly the thing people write in
 *     asking about.
 *
 * The cost of the calendar week is a boundary burst: three submissions late
 * Sunday and three more minutes later on Monday. Accepted — the burst is
 * bounded by the same 10-per-task total, which is the limit that actually caps
 * oracle exposure. The weekly cap only paces.
 *
 * UTC, not participant-local: this is a global challenge, and a local week
 * would make "when does it reset" ambiguous in exactly the way a concrete
 * instant is supposed to prevent.
 */

import type { ScoredSubmissionQuotaScope, ScoredSubmissionQuotaState } from '@oci/shared-types';

/** Default scored submissions per participant per task per calendar week. */
export const DEFAULT_SCORED_SUBMISSIONS_PER_WEEK = 3;

/** Default scored submissions per participant per task, ever. */
export const DEFAULT_SCORED_SUBMISSIONS_PER_TASK = 10;

/** The two caps actually in force. */
export interface ScoredQuotaLimits {
  perWeek: number;
  perTask: number;
}

/**
 * Read the caps from the environment, falling back to the defaults.
 *
 * An unparseable or non-positive value falls back rather than throwing, and
 * says so in the returned `warnings`. The alternative — refusing to start —
 * would take the whole API down over a typo in an operational knob, and the
 * fallback is the published default rather than "unlimited", so the failure
 * mode is a working platform with the documented caps.
 *
 * `perWeek > perTask` is reported but honoured. It is almost certainly a
 * mistake (the weekly cap can never bind, since the lifetime cap is reached
 * first), but it is not dangerous — the stricter limit still applies — and
 * silently rewriting an operator's explicit number would be worse than saying
 * it looks wrong.
 */
export function resolveScoredQuotaLimits(env: {
  OCI_EVAL_SCORED_PER_WEEK?: string | undefined;
  OCI_EVAL_SCORED_PER_TASK?: string | undefined;
}): { limits: ScoredQuotaLimits; warnings: string[] } {
  const warnings: string[] = [];

  const read = (raw: string | undefined, name: string, fallback: number): number => {
    if (raw === undefined || raw.trim() === '') return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) {
      warnings.push(`${name}="${raw}" is not a positive integer — using the default ${fallback}`);
      return fallback;
    }
    return n;
  };

  const perWeek = read(
    env.OCI_EVAL_SCORED_PER_WEEK,
    'OCI_EVAL_SCORED_PER_WEEK',
    DEFAULT_SCORED_SUBMISSIONS_PER_WEEK,
  );
  const perTask = read(
    env.OCI_EVAL_SCORED_PER_TASK,
    'OCI_EVAL_SCORED_PER_TASK',
    DEFAULT_SCORED_SUBMISSIONS_PER_TASK,
  );

  if (perWeek > perTask) {
    warnings.push(
      `weekly cap (${perWeek}) exceeds the per-task total (${perTask}), so the weekly cap can ` +
        'never bind — the total is reached first. Honouring both as given.',
    );
  }

  return { limits: { perWeek, perTask }, warnings };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Start of the ISO calendar week containing `now`: the preceding (or current)
 * Monday at 00:00:00.000 UTC. This is the `createdAt >=` bound of the weekly
 * count.
 */
export function quotaWeekStart(now: Date): Date {
  const midnightUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  // getUTCDay(): 0 = Sunday … 6 = Saturday. ISO weeks start Monday, so shift
  // the index (Monday → 0 … Sunday → 6) and subtract it. Sunday therefore
  // belongs to the week that began six days earlier, not to the next one.
  const isoDayIndex = (new Date(midnightUtc).getUTCDay() + 6) % 7;
  return new Date(midnightUtc - isoDayIndex * MS_PER_DAY);
}

/**
 * The instant the weekly allowance frees up: next Monday 00:00:00.000 UTC.
 * Plain millisecond arithmetic is exact here because UTC has no DST.
 */
export function nextQuotaWeekStart(now: Date): Date {
  return new Date(quotaWeekStart(now).getTime() + 7 * MS_PER_DAY);
}

/**
 * Refusal text for the weekly cap. States the limit, the window it applies to,
 * and a concrete reset instant — so nobody has to email support to find out
 * when they can submit again — and points at the unlimited unscored path that
 * is the right tool for whatever they were about to spend a slot on.
 */
export function weeklyQuotaExceededMessage(
  taskSlug: string,
  resetsAt: Date,
  perWeek: number,
): string {
  return (
    `Weekly scored-submission limit reached for evaluation task "${taskSlug}": ` +
    `${perWeek} scored submissions per participant per calendar week ` +
    `(weeks start Monday 00:00:00 UTC). This limit resets at ${resetsAt.toISOString()}. ` +
    `Validation submissions are unlimited, are never scored and never count against this limit — ` +
    `resend the same body with "intent": "VALIDATION" to check the interface contract.`
  );
}

/**
 * Refusal text for the per-task total. Says outright that this one does NOT
 * reset: promising a reset instant that will never arrive would be worse than
 * saying there is none.
 */
export function totalQuotaExceededMessage(taskSlug: string, perTask: number): string {
  return (
    `Total scored-submission limit reached for evaluation task "${taskSlug}": ` +
    `${perTask} scored submissions per participant for the lifetime of the ` +
    `task. This limit does not reset — there is no later instant at which it frees up, because ` +
    `every scored submission is one query against the task's hidden ground truth. ` +
    `Validation submissions are unlimited, are never scored and never count against this limit — ` +
    `resend the same body with "intent": "VALIDATION" to check the interface contract.`
  );
}

/** Machine-readable companion to the refusal text, for the 429 payload. */
export function quotaState(
  scope: ScoredSubmissionQuotaScope,
  used: number,
  resetsAt: Date | null,
  limits: ScoredQuotaLimits,
): ScoredSubmissionQuotaState {
  return {
    scope,
    limit: scope === 'WEEK' ? limits.perWeek : limits.perTask,
    used,
    resetsAt: resetsAt === null ? null : resetsAt.toISOString(),
  };
}
