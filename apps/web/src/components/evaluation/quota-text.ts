import type { ScoredSubmissionQuotaState, ScoredSubmissionQuotaSummary } from '@oci/shared-types';
import type { EvaluationI18n } from './i18n';

/**
 * The sentences that tell a participant how many scored submissions they have
 * left (#645), in the interface language (#654). Pure, so the wording is
 * unit-tested.
 *
 * The reset is printed in UTC and says so. The limit resets at one instant for
 * everyone (Monday 00:00 UTC); a time rendered in the server's zone and read in
 * another would name the wrong hour.
 */

export function formatQuotaReset({ t, f }: EvaluationI18n, iso: string): string {
  const date = f.date(iso, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
  return t('quota.reset', { date });
}

export interface QuotaText {
  /** False when the caller cannot submit for scoring now. */
  available: boolean;
  /** Shown beside the submit button. */
  summary: string;
  /** A second sentence, when there is something to add. */
  detail: string | null;
}

export function describeQuota(
  i18n: EvaluationI18n,
  quota: ScoredSubmissionQuotaSummary,
): QuotaText {
  const { t, f } = i18n;
  if (quota.total.remaining === 0) {
    return {
      available: false,
      summary: t('quota.totalUsedSummary'),
      detail: t('quota.totalUsedDetail', { limit: f.number(quota.total.limit) }),
    };
  }
  if (quota.week.remaining === 0) {
    return {
      available: false,
      summary: t('quota.weekUsedSummary'),
      detail: t('quota.weekUsedDetail', {
        limit: f.number(quota.week.limit),
        reset: formatQuotaReset(i18n, quota.week.resetsAt),
      }),
    };
  }
  return {
    available: true,
    summary: t('quota.summary', {
      remaining: f.number(quota.week.remaining),
      limit: f.number(quota.week.limit),
    }),
    detail: t('quota.detail', {
      remaining: f.number(quota.total.remaining),
      limit: f.number(quota.total.limit),
    }),
  };
}

/** The same, for the refusal the API sends when a limit was hit at submit time. */
export function describeQuotaRefusal(
  i18n: EvaluationI18n,
  state: ScoredSubmissionQuotaState,
): string {
  const { t, f } = i18n;
  if (state.scope === 'WEEK' && state.resetsAt) {
    return t('quota.refusedWeek', {
      limit: f.number(state.limit),
      reset: formatQuotaReset(i18n, state.resetsAt),
    });
  }
  return t('quota.refusedTotal', { limit: f.number(state.limit) });
}
