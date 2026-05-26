import { Logger } from '@nestjs/common';
import { buildFleissMatrix, fleissKappa } from '@oci/annotation-quality';
import type {
  AnnotationQualityMetric,
  CampaignQualityConfig,
  CampaignTaskKind,
} from '@oci/shared-types';

/**
 * Gate-1 decision-box predicate (#215 slice 3, ADR-0008 §IRR thresholds).
 *
 * Runs when the N-th INDEPENDENT submission lands. Computes IRR
 * across the N submissions per the campaign's quality config; if
 * agreement meets / exceeds the threshold, the workflow engine
 * skips AWAITING_ARBITRATION and closes the task directly. Otherwise
 * the gate advances normally to arbitration.
 *
 * Scope cut (slice-3 first cut):
 *   - Implements `fleiss-kappa` and `cohens-kappa` for categorical
 *     task kinds (CLASSIFICATION / DETECTION / LOCALIZATION /
 *     MULTI_MODAL) over each submission's `label` field.
 *   - Segmentation defers — `dice` requires actual mask data, which
 *     only arrives once the ADR-0007 tool-integration handoff
 *     (#214) lands. For now SEGMENTATION campaigns always escalate
 *     to arbitration.
 *   - Missing / empty labels cause the predicate to abstain (no
 *     IRR pass); the task escalates to arbitration so a human
 *     resolves it.
 *
 * Pure function — no DB, no Prisma; the service supplies the
 * already-fetched submission payloads.
 */

const logger = new Logger('GateIrrPredicate');

export interface PredicateInput {
  taskKind: CampaignTaskKind;
  quality: CampaignQualityConfig;
  /** Free-form submission JSON for each of the N independent raters. */
  submissions: ReadonlyArray<Record<string, unknown>>;
}

export interface PredicateResult {
  /** True when the IRR meets / exceeds the campaign's threshold. */
  passed: boolean;
  /** The computed IRR score, or null when the predicate abstained. */
  irr: number | null;
  /** Metric the predicate actually ran. Null when it abstained. */
  metricApplied: AnnotationQualityMetric | null;
  /** Threshold compared against — useful for telemetry / audit. */
  threshold: number;
  /** Short human-readable reason; surfaces in audit payload + logs. */
  reason: string;
}

export function evaluateGate1Predicate(input: PredicateInput): PredicateResult {
  const threshold = input.quality.threshold;

  // Segmentation can't be evaluated until real mask payloads exist
  // (post-#214). Until then we always escalate so a human reviews
  // the placeholder JSON submissions.
  if (input.taskKind === 'SEGMENTATION') {
    return {
      passed: false,
      irr: null,
      metricApplied: null,
      threshold,
      reason: 'segmentation predicate deferred (ADR-0007 tool integration, #214)',
    };
  }

  const labels = input.submissions.map((s) => extractLabel(s));
  if (labels.some((l) => l === null)) {
    return {
      passed: false,
      irr: null,
      metricApplied: null,
      threshold,
      reason: 'one or more submissions lack a usable `label` field — escalating',
    };
  }
  const present = labels as string[];

  // Unanimous-label shortcut: Fleiss requires ≥ 2 categories, but
  // every-rater-agrees is the most desirable IRR outcome possible.
  // Skip the metric and report a perfect pass.
  if (new Set(present).size === 1) {
    return {
      passed: true,
      irr: 1,
      metricApplied: input.quality.metric === 'dice' ? 'fleiss-kappa' : input.quality.metric,
      threshold,
      reason: 'unanimous agreement — skipping arbitration',
    };
  }

  // Fleiss' κ handles N≥2 (including N=2 — equivalent to Cohen's κ
  // there). We always run Fleiss; the `cohens-kappa` config value
  // is accepted in this PR as an alias and will become a separate
  // code path if/when 2-rater-only campaigns need different
  // behaviour from the general N case.
  const { matrix } = buildFleissMatrix([present]);
  const result = fleissKappa(matrix);

  if (!Number.isFinite(result.kappa)) {
    // Degenerate: all raters agreed AND there's no variance in the
    // marginal distribution (one-class case). Treat unanimous agreement
    // as a pass — that's what the campaign manager would want.
    return {
      passed: true,
      irr: 1,
      metricApplied: input.quality.metric === 'dice' ? 'fleiss-kappa' : input.quality.metric,
      threshold,
      reason: 'unanimous agreement (degenerate κ; treated as 1)',
    };
  }

  const passed = result.kappa >= threshold;
  logger.log(
    `gate-1 predicate: κ=${result.kappa.toFixed(3)} threshold=${threshold} → ${passed ? 'PASS' : 'FAIL'} (n=${present.length})`,
  );
  return {
    passed,
    irr: result.kappa,
    metricApplied: input.quality.metric === 'dice' ? 'fleiss-kappa' : input.quality.metric,
    threshold,
    reason: passed ? 'IRR ≥ threshold — skipping arbitration' : 'IRR < threshold — escalating',
  };
}

function extractLabel(submission: Record<string, unknown>): string | null {
  const value = submission.label;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
