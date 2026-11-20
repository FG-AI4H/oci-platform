import type { ScoredSubmissionQuotaState, ScoredSubmissionQuotaSummary } from '@oci/shared-types';

/**
 * The sentences that tell a participant how many scored submissions they have
 * left (#645). Pure, so the wording is unit-tested.
 *
 * The reset is printed in UTC and says so. The limit resets at one instant for
 * everyone (Monday 00:00 UTC); a time rendered in the server's zone and read in
 * another would name the wrong hour.
 */

const RESET_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
});

export function formatQuotaReset(iso: string): string {
  return `${RESET_FORMATTER.format(new Date(iso))} UTC`;
}

const n = (value: number) => value.toLocaleString('en-GB');

export interface QuotaText {
  /** False when the caller cannot submit for scoring now. */
  available: boolean;
  /** Shown beside the submit button. */
  summary: string;
  /** A second sentence, when there is something to add. */
  detail: string | null;
}

export function describeQuota(quota: ScoredSubmissionQuotaSummary): QuotaText {
  if (quota.total.remaining === 0) {
    return {
      available: false,
      summary: 'No scored submissions left on this task.',
      detail: `All ${n(quota.total.limit)} allowed on this task are used. This limit does not reset. Checking the format stays free.`,
    };
  }
  if (quota.week.remaining === 0) {
    return {
      available: false,
      summary: 'No scored submissions left this week.',
      detail: `All ${n(quota.week.limit)} for this week are used. The limit resets on ${formatQuotaReset(quota.week.resetsAt)}. Checking the format stays free.`,
    };
  }
  return {
    available: true,
    summary: `${n(quota.week.remaining)} of ${n(quota.week.limit)} scored submissions left this week.`,
    detail: `${n(quota.total.remaining)} of ${n(quota.total.limit)} left on this task in total.`,
  };
}

/** The same, for the refusal the API sends when a limit was hit at submit time. */
export function describeQuotaRefusal(state: ScoredSubmissionQuotaState): string {
  if (state.scope === 'WEEK' && state.resetsAt) {
    return `Not submitted: all ${n(state.limit)} scored submissions for this week are used. The limit resets on ${formatQuotaReset(state.resetsAt)}.`;
  }
  return `Not submitted: all ${n(state.limit)} scored submissions allowed on this task are used. This limit does not reset.`;
}
