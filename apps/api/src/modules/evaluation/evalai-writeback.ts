/**
 * EvalAI write-back (WP4, #408, evalai-integration §4–§5).
 *
 * EvalAI owns the participant-facing surface; the OCI owns execution and
 * scoring. Once a result is persisted here it must become visible where the
 * participant submitted it — but **never at the cost of the result itself**.
 *
 * The ordering is therefore fixed: persist first, publish second. Everything in
 * this file is about re-posting a result that already exists, which is why none
 * of it can fail in a way that loses a score. The EvalAI stack sits outside CDK
 * in a flat public VPC and has had a six-day outage; a synchronous dependency on
 * it being reachable would make a public challenge as available as its weakest
 * component (§5).
 */

/** Backoff schedule in ms. Deliberately short-then-long: most failures are a
 * restart, a few are a multi-day outage, and the queue buffers either way. */
const BACKOFF_MS = [0, 30_000, 120_000, 600_000, 3_600_000, 21_600_000] as const;

/** Attempts after which a row is reported to an operator rather than retried
 * quietly. It keeps retrying — this is the point at which silence stops being
 * acceptable, not the point at which we give up. */
export const WRITEBACK_ALERT_AFTER_ATTEMPTS = 4;

/**
 * When may this row be retried? Pure, so the sweep is testable without a clock.
 * Attempts beyond the schedule hold at the final interval rather than escalating
 * for ever.
 */
export function nextWritebackAttemptAt(args: { attempts: number; lastAttemptAt: Date }): Date {
  const i = Math.min(Math.max(args.attempts, 0), BACKOFF_MS.length - 1);
  // `.at()` rather than `BACKOFF_MS[i]`: a computed bracket index trips
  // eslint security/detect-object-injection, and the read is identical.
  const wait = BACKOFF_MS.at(i) ?? BACKOFF_MS.at(-1) ?? 0;
  return new Date(args.lastAttemptAt.getTime() + wait);
}

export function writebackIsDue(args: {
  attempts: number;
  lastAttemptAt: Date | null;
  now: Date;
}): boolean {
  if (args.lastAttemptAt === null) return true;
  return (
    args.now >=
    nextWritebackAttemptAt({ attempts: args.attempts, lastAttemptAt: args.lastAttemptAt })
  );
}

/** True once an operator should be told, per §4's "silence here is how 'the
 * leaderboard is wrong' becomes a Hangzhou question". */
export function writebackNeedsAlert(attempts: number): boolean {
  return attempts >= WRITEBACK_ALERT_AFTER_ATTEMPTS;
}

/**
 * The payload posted to EvalAI for one submission.
 *
 * Deliberately carries the OCI submission id and the route attribution as well
 * as the metrics: a score without its route is not a meaningful result
 * (conformance spec §7), and that holds on the participant-facing surface too,
 * not only in our own API.
 */
export interface EvalAiResultPayload {
  /** EvalAI's own submission id — the row being updated. */
  externalSubmissionId: string;
  /** Terminal outcome. EvalAI distinguishes finished from failed. */
  status: 'FINISHED' | 'FAILED';
  /** Flat metric map for EvalAI's leaderboard. Empty when FAILED. */
  metrics: Record<string, number>;
  /** Participant-facing failure text. Never the worker's operator detail. */
  errorMessage: string | null;
  /** Provenance the participant is entitled to see. */
  ociSubmissionId: string;
  routeSlug: string | null;
  routeVersion: string | null;
  /**
   * Idempotency key. EvalAI's side must treat a repeat of the same key as a
   * no-op: the sweep re-posts, so a duplicate delivery is expected traffic
   * rather than an error condition.
   */
  idempotencyKey: string;
}

/**
 * Flatten the ADR-0020 `{ kind, metrics }` envelope for EvalAI's leaderboard,
 * which takes a flat metric map.
 *
 * The `kind` is preserved as a prefix rather than dropped. Two scoring families
 * both have an `accuracy` that means different things; merging them into one
 * column would silently compare numbers that are not comparable — the same
 * reason the envelope exists here in the first place.
 */
export function flattenScoresForEvalAi(scores: unknown): Record<string, number> {
  if (scores === null || typeof scores !== 'object') return {};
  const env = scores as { kind?: unknown; metrics?: unknown };
  const kind = typeof env.kind === 'string' ? env.kind : null;
  const metrics = env.metrics;
  if (!kind || metrics === null || typeof metrics !== 'object') return {};

  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(metrics as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[`${kind.toLowerCase()}_${k}`] = v;
  }
  return out;
}
