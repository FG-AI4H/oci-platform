import { z } from 'zod';

/**
 * The periodic activity report of one deployment (#828; Lab requirement
 * Req-036: regular reports on test results, model performance and dataset
 * quality).
 *
 * One calendar month, in UTC. Counts and public entries only: no person is
 * named, and nothing is listed that the catalogue does not already publish.
 * Assembled on request from what the platform records; nothing is stored, so
 * a report for a past month reads the same data again and gives the same
 * figures, apart from what was retracted or withdrawn since.
 *
 * Self-contained on purpose (no import from the barrel): `index.ts`
 * re-exports this module.
 */

/** A calendar month, `YYYY-MM`. */
export const ActivityReportMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'expected a month as YYYY-MM');
export type ActivityReportMonth = z.infer<typeof ActivityReportMonthSchema>;

/** `GET /v2/reports/activity`. Without a month: the last complete one. */
export const ActivityReportQuerySchema = z.object({
  month: z.preprocess(
    (v) => (typeof v === 'string' && v.trim().length === 0 ? undefined : v),
    ActivityReportMonthSchema.optional(),
  ),
});
export type ActivityReportQuery = z.infer<typeof ActivityReportQuerySchema>;

/** The month's first instant and the next month's, in UTC: `[from, to)`. */
export function monthBounds(month: ActivityReportMonth): { from: Date; to: Date } {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1;
  return { from: new Date(Date.UTC(year, index, 1)), to: new Date(Date.UTC(year, index + 1, 1)) };
}

/** The month that holds `at`, in UTC. */
export function monthOf(at: Date): ActivityReportMonth {
  return `${String(at.getUTCFullYear()).padStart(4, '0')}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The last complete month before `now`, in UTC. */
export function lastCompleteMonth(now: Date): ActivityReportMonth {
  return monthOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
}

/** The months a report can be asked for: `count` of them, newest first, ending with the current one. */
export function recentMonths(now: Date, count: number): ActivityReportMonth[] {
  return Array.from({ length: count }, (_, back) =>
    monthOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))),
  );
}

export interface ActivityReportDatasetVersion {
  slug: string;
  name: string;
  version: string;
  publishedAt: string;
}

export interface ActivityReportTask {
  slug: string;
  name: string;
  taskKind: string;
  datasetSlug: string;
  /** Submissions received in the period, and how they ended. */
  received: number;
  scored: number;
  failed: number;
  /**
   * The best published result on the task as it stands today, whenever it was
   * submitted: the metric the task ranks by, and its value. Null when the task
   * has no published result. A result is published by the evaluation module's
   * own rule (an approved method version, not retracted).
   */
  best: { methodName: string; metricLabel: string; value: number } | null;
  /** Published results on the task today. */
  publishedResults: number;
}

export interface ActivityReportCampaign {
  slug: string;
  name: string;
  status: string;
  /** Tasks whose independent reading is finished, and those still open. */
  tasksCounted: number;
  tasksOpen: number;
  /** Share of counted tasks the readers did not settle; null when none is counted. */
  arbitrationShare: number | null;
  /** Fleiss' kappa over the counted tasks; null below the campaign's minimum. */
  fleissKappa: number | null;
  /** Share of reader pairs that gave the same answer; null below the minimum. */
  percentAgreement: number | null;
}

export interface ActivityReport {
  v: 1;
  month: ActivityReportMonth;
  /** `[from, to)`, UTC. */
  from: string;
  to: string;
  /** True when the month is not over: the figures will still move. */
  partial: boolean;
  generatedAt: string;
  /** The deployment the figures are for (`local`, `dev`, `int`, `prod`). */
  deployment: string;

  datasets: {
    /** Public, published datasets at the end of the period. */
    publishedAtEnd: number;
    /** Versions published in the period, on public datasets. */
    versionsPublished: number;
    /** Those versions, newest first, at most 50. */
    versions: ActivityReportDatasetVersion[];
  };

  accessRequests: {
    /** Filed in the period. */
    submitted: number;
    /** Decided in the period, by outcome. */
    approved: number;
    denied: number;
    /** Still waiting for a decision at the end of the period. */
    pendingAtEnd: number;
  };

  evaluation: {
    /** Evaluation tasks at the end of the period. */
    tasks: number;
    received: number;
    scored: number;
    failed: number;
    /** Tasks that received a submission in the period or hold a published result. */
    byTask: ActivityReportTask[];
  };

  models: {
    /** Published model cards today. */
    published: number;
    /** Cards published in the period, read from the audit trail. */
    publishedInPeriod: number;
  };

  annotation: {
    /** Campaigns that are running or completed. */
    campaigns: ActivityReportCampaign[];
  };

  audit: {
    /** Events recorded in the period. */
    events: number;
    /**
     * The hash chain over the period's events: `intact`, `broken`, or `empty`
     * when the period has no event. `unverified` when the period holds more
     * events than one check covers; the audit trail reader verifies any range.
     */
    chain: 'intact' | 'broken' | 'empty' | 'unverified';
    checked: number;
  };
}
