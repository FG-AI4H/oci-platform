/**
 * Results by subgroup (#410, ADR-0030). Pure, no NestJS / Prisma deps.
 *
 * For each declared field and each of its values, the items of that group are
 * scored by the task kind's OWN scorer, through `scoreByKind`, exactly as the
 * whole set is. Nothing here computes a metric: a subgroup's accuracy is the
 * same function as the overall accuracy, run on fewer items. What this module
 * adds is the partition, the counting that suppression needs, and the choice
 * of which figures a group publishes.
 *
 * Suppression happens HERE, before anything is returned, and the returned
 * object is what is stored and what is published. A withheld group is
 * returned with its value and label only: its figures are never computed into
 * the result, so no later read path can leak them.
 */

/* eslint-disable security/detect-object-injection --
 * Item ids index the answer key, the predictions and the item map. Every id
 * is an own key of the answer key (`Object.keys`), every read is either
 * guarded by `hasOwnProperty` or of a key the answer key owns, and nothing is
 * written into those objects: group maps are built with `Object.fromEntries`,
 * which defines own properties even for a key such as `__proto__`. Field keys
 * come from the validated declaration (`SubgroupFieldKeySchema`, letters and
 * digits only). Numeric indexes are bounded loop counters. */

import type {
  SubgroupCell,
  SubgroupField,
  SubgroupItemValues,
  SubgroupMetrics,
  SubgroupResults,
} from '@oci/shared-types';

import { scoreByKind, type KindScores, type TaskScoringConfig } from './scoring-registry.js';
import { suppressGroups, suppressRates } from './subgroup-suppression.js';

/** What the task holds for subgroups: the declaration and the item map. */
export interface SubgroupConfig {
  fields: readonly SubgroupField[];
  values: SubgroupItemValues;
}

/**
 * Score one submission by subgroup.
 *
 * Called only after the whole-set scoring has succeeded on the same, already
 * validated payload, so a refusal is not expected here: one would be a server
 * fault and is left to propagate. It must never become a FAILED submission,
 * because a failure after the labels were consulted would be a free oracle
 * query (see `consumesScoredQuota`).
 *
 * Returns `null` when the task declares no field.
 */
export function scoreSubgroups(args: {
  kind: string;
  groundTruth: Record<string, number>;
  predictions: Record<string, number>;
  itemScores?: Record<string, number> | undefined;
  config: TaskScoringConfig;
  subgroups: SubgroupConfig | null;
  minCellSize: number;
}): SubgroupResults | null {
  const { subgroups, minCellSize } = args;
  if (subgroups === null || subgroups.fields.length === 0) return null;

  const itemIds = Object.keys(args.groundTruth).sort();
  const has = (rec: Record<string, unknown>, id: string) =>
    Object.prototype.hasOwnProperty.call(rec, id);

  const fields = subgroups.fields.map((field) => {
    const groups = field.values.map((v) => {
      const items = itemIds.filter((id) => subgroups.values[id]?.[field.key] === v.value);
      const scored = items.filter((id) => has(args.predictions, id));
      return { declared: v, items, scored };
    });

    const groupWithheld = suppressGroups(
      groups.map((g) => g.scored.length),
      groups.map((g) => g.items.length),
      minCellSize,
    );
    const denominators = groups.map((g) =>
      rateDenominators(args.kind, g.scored, args, args.config),
    );
    const ratesWithheld = suppressRates(groupWithheld, denominators, minCellSize);

    const cells: SubgroupCell[] = groups.map((g, i) => {
      if (groupWithheld[i]) {
        return { status: 'SUPPRESSED', value: g.declared.value, label: g.declared.label };
      }
      const pick = (rec: Record<string, number>) =>
        Object.fromEntries(g.items.filter((id) => has(rec, id)).map((id) => [id, rec[id]!]));
      const itemScores = args.itemScores ? pick(args.itemScores) : {};
      const scores = scoreByKind({
        kind: args.kind,
        groundTruth: Object.fromEntries(g.items.map((id) => [id, args.groundTruth[id]!])),
        predictions: pick(args.predictions),
        itemScores: Object.keys(itemScores).length > 0 ? itemScores : undefined,
        config: args.config,
      });
      return {
        status: 'REPORTED',
        value: g.declared.value,
        label: g.declared.label,
        itemCount: g.items.length,
        scoredCount: g.scored.length,
        metrics: headline(scores, ratesWithheld[i] ?? true, denominators[i] ?? []),
      };
    });

    return { key: field.key, label: field.label, cells };
  });

  return { minCellSize, fields };
}

/**
 * The counts a group's published rates rest on, besides its scored items.
 * Counting only: which items fall on which side of the reference and of the
 * file's label. Each is a column whose total the aggregate result publishes.
 *
 *   - BINARY_DIAGNOSTIC: positive and negative reference items (sensitivity,
 *     specificity, prevalence), positive and negative file labels (the two
 *     predictive values).
 *   - GRADING: referable and non-referable reference items (the two
 *     referable rates).
 *   - CLASSIFICATION: none. Its group figures (accuracy, balanced accuracy,
 *     macro F1) rest on the scored items alone; the per-class table, which
 *     rests on per-class counts, is not published by group.
 */
function rateDenominators(
  kind: string,
  scored: readonly string[],
  data: { groundTruth: Record<string, number>; predictions: Record<string, number> },
  config: TaskScoringConfig,
): number[] {
  const count = (keep: (id: string) => boolean) => scored.filter(keep).length;
  if (kind === 'BINARY_DIAGNOSTIC') {
    return [
      count((id) => data.groundTruth[id] === 1),
      count((id) => data.groundTruth[id] !== 1),
      count((id) => data.predictions[id] === 1),
      count((id) => data.predictions[id] !== 1),
    ];
  }
  if (kind === 'GRADING') {
    const t = config.referableThreshold ?? 2;
    return [
      count((id) => (data.groundTruth[id] ?? 0) >= t),
      count((id) => (data.groundTruth[id] ?? 0) < t),
    ];
  }
  return [];
}

/** The figures a reported group publishes, from its own scores. */
function headline(
  scores: KindScores,
  ratesWithheld: boolean,
  denominators: readonly number[],
): SubgroupMetrics {
  switch (scores.kind) {
    case 'CLASSIFICATION':
      return {
        kind: 'CLASSIFICATION',
        accuracy: scores.metrics.accuracy,
        balancedAccuracy: scores.metrics.balancedAccuracy,
        macroF1: scores.metrics.macroF1,
      };
    case 'GRADING': {
      // The grading scorer reports 0 for a rate with an empty denominator;
      // by group, that is "not estimable", which is not 0.
      return {
        kind: 'GRADING',
        qwk: scores.metrics.qwk,
        accuracy: scores.metrics.accuracy,
        referableSensitivity:
          ratesWithheld || denominators[0] === 0 ? null : scores.metrics.referableSensitivity,
        referableSpecificity:
          ratesWithheld || denominators[1] === 0 ? null : scores.metrics.referableSpecificity,
        ratesWithheld,
      };
    }
    case 'BINARY_DIAGNOSTIC': {
      const m = scores.metrics;
      // Accuracy rests on the group's scored items, which are at least the
      // threshold for a reported group, so it is never null here.
      if (m.accuracy === null) throw new Error('a reported group has no scored item');
      return {
        kind: 'BINARY_DIAGNOSTIC',
        accuracy: m.accuracy,
        prevalence: ratesWithheld ? null : m.prevalence,
        sensitivity: ratesWithheld ? null : m.sensitivity,
        specificity: ratesWithheld ? null : m.specificity,
        positivePredictiveValue: ratesWithheld ? null : m.positivePredictiveValue,
        negativePredictiveValue: ratesWithheld ? null : m.negativePredictiveValue,
        balancedAccuracy: ratesWithheld ? null : m.balancedAccuracy,
        auc: ratesWithheld ? null : m.auc,
        ratesWithheld,
      };
    }
  }
}
