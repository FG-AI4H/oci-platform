import type { CampaignStatus } from '@oci/database';
import type { CampaignTransitionAction } from '@oci/shared-types';

/**
 * Campaign-lifecycle state machine (#215, slice 1). The transition
 * matrix is authoritative — the service consults this table to decide
 * if an action is legal from the current status, what the target
 * status is, and which fields must be set on the row.
 *
 * Diagram lives at `docs/for-developers/annotation-module.md`. Keep
 * the diagram in sync if you change the transitions here.
 */

export interface TransitionRule {
  /** Status the row ends in if the transition fires. */
  to: CampaignStatus;
  /** Whether the caller MUST supply a non-empty `reason`. */
  reasonRequired: boolean;
  /**
   * Side-effect flags consumed by the service to derive timestamp
   * column updates (denormalised milestones on the row). The service
   * sets the corresponding column to `now()` when the flag is true.
   */
  stampStartedAt?: boolean;
  stampCompletedAt?: boolean;
}

const MATRIX: Record<CampaignStatus, Partial<Record<CampaignTransitionAction, TransitionRule>>> = {
  DRAFT: {
    'mark-ready': { to: 'READY', reasonRequired: false },
  },
  READY: {
    'revert-to-draft': { to: 'DRAFT', reasonRequired: true },
    start: { to: 'RUNNING', reasonRequired: false, stampStartedAt: true },
  },
  RUNNING: {
    complete: { to: 'COMPLETED', reasonRequired: false, stampCompletedAt: true },
    // Emergency stop. Reason is mandatory so the audit trail has the
    // operator's words attached. Once slice 2 lands the task model,
    // archive-from-RUNNING also cancels in-flight task assignments.
    archive: { to: 'ARCHIVED', reasonRequired: true },
  },
  COMPLETED: {
    archive: { to: 'ARCHIVED', reasonRequired: false },
  },
  ARCHIVED: {
    // Terminal. No outgoing transitions; restoring an archived
    // campaign is intentionally not in scope — a campaign manager
    // would clone instead.
  },
};

/** Look up the rule for `(currentStatus, action)`; null if illegal. */
export function lookupTransition(
  current: CampaignStatus,
  action: CampaignTransitionAction,
): TransitionRule | null {
  // eslint-disable-next-line security/detect-object-injection -- typed enum keys
  const fromRules = MATRIX[current];
  if (!fromRules) return null;
  // eslint-disable-next-line security/detect-object-injection -- typed enum keys
  return fromRules[action] ?? null;
}

/** Actions legal from the given status — used to drive UI button visibility. */
export function availableActions(status: CampaignStatus): CampaignTransitionAction[] {
  // eslint-disable-next-line security/detect-object-injection -- typed enum keys
  const rules = MATRIX[status];
  if (!rules) return [];
  return Object.keys(rules) as CampaignTransitionAction[];
}
