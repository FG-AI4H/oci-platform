import type { AnnotationGateState } from '@oci/database';
import type { GateTransitionAction } from '@oci/shared-types';

/**
 * Gate-state machine for AnnotationTask (#215 slice 2, ADR-0006
 * Decision 3 + ADR-0008 §IRR thresholds).
 *
 * The campaign-state-machine handles the campaign envelope (DRAFT →
 * READY → RUNNING → …); this one handles a single task's progression
 * through the 3-gate SOP from ITU-T FG-AI4H DEL05-A03.
 *
 * Slice 2 implements the minimum surface: track gate transitions, no
 * IRR-threshold consensus check at gate 1. When N=1 the task auto-
 * completes after the single independent submission (single-rater
 * shortcut from ADR-0009 Decision 2 "minimum N=1"); when N≥2 a task
 * always escalates from INDEPENDENT to AWAITING_ARBITRATION after N
 * submissions land, regardless of agreement. The consensus check that
 * lets a task skip arbitration when all N raters agreed lands in
 * slice 3 alongside the IRR scorer (#216).
 *
 * Expert-review is final per ADR-0008 — there is no AWAITING_EXPERT →
 * AWAITING_ARBITRATION path; an expert disagreement closes the task.
 */

export interface GateTransitionRule {
  to: AnnotationGateState;
  reasonRequired: boolean;
  /** Set when the transition completes the task (stamps completedAt). */
  stampCompletedAt?: boolean;
}

const MATRIX: Record<
  AnnotationGateState,
  Partial<Record<GateTransitionAction, GateTransitionRule>>
> = {
  INDEPENDENT: {
    // Slice 2: when N=1 the service emits this action and the task
    // completes; when N≥2 it emits `independent-submitted` per row
    // and only fires the gate transition once N submissions are in.
    // Either way the action lands here; the service decides the
    // target by inspecting the campaign's N.
    'independent-submitted': { to: 'AWAITING_ARBITRATION', reasonRequired: false },
    skip: { to: 'SKIPPED', reasonRequired: true, stampCompletedAt: true },
  },
  AWAITING_ARBITRATION: {
    'arbitration-submitted': {
      to: 'COMPLETED',
      reasonRequired: false,
      stampCompletedAt: true,
    },
    'escalate-to-expert': { to: 'AWAITING_EXPERT', reasonRequired: true },
    skip: { to: 'SKIPPED', reasonRequired: true, stampCompletedAt: true },
  },
  AWAITING_EXPERT: {
    'expert-submitted': {
      to: 'COMPLETED',
      reasonRequired: false,
      stampCompletedAt: true,
    },
    skip: { to: 'SKIPPED', reasonRequired: true, stampCompletedAt: true },
  },
  COMPLETED: {
    // Terminal — re-opening a completed task is intentionally out of
    // scope. Operator clones the campaign or files a rejection.
  },
  SKIPPED: {
    // Terminal — same reasoning as COMPLETED.
  },
};

/**
 * Variant of `MATRIX` for the N=1 single-rater shortcut. The router
 * uses the campaign's `nAnnotatorsRequired` to decide which one to
 * apply when an independent submission lands.
 */
const N_EQUALS_ONE_OVERRIDES: Partial<
  Record<AnnotationGateState, Partial<Record<GateTransitionAction, GateTransitionRule>>>
> = {
  INDEPENDENT: {
    'independent-submitted': {
      to: 'COMPLETED',
      reasonRequired: false,
      stampCompletedAt: true,
    },
  },
};

/** Look up the rule for `(currentGate, action)`; null if illegal. */
export function lookupGateTransition(
  current: AnnotationGateState,
  action: GateTransitionAction,
  nAnnotatorsRequired: number,
): GateTransitionRule | null {
  if (nAnnotatorsRequired === 1) {
    // eslint-disable-next-line security/detect-object-injection -- typed enum keys
    const override = N_EQUALS_ONE_OVERRIDES[current];
    // eslint-disable-next-line security/detect-object-injection -- typed enum keys
    const overrideRule = override?.[action];
    if (overrideRule) return overrideRule;
  }
  // eslint-disable-next-line security/detect-object-injection -- typed enum keys
  const fromRules = MATRIX[current];
  if (!fromRules) return null;
  // eslint-disable-next-line security/detect-object-injection -- typed enum keys
  return fromRules[action] ?? null;
}

/** Actions legal from the given gate state — drives UI affordances. */
export function availableGateActions(state: AnnotationGateState): GateTransitionAction[] {
  // eslint-disable-next-line security/detect-object-injection -- typed enum keys
  const rules = MATRIX[state];
  if (!rules) return [];
  return Object.keys(rules) as GateTransitionAction[];
}
