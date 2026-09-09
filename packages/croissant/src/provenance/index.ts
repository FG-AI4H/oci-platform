import type { AccessTier } from '@oci/shared-types';
import type { ValidationIssue, ValidationLevel } from '../validator/index.js';
import {
  DEPRECATED_ACTIVITY_KIND_PROPERTY,
  DEPRECATED_PROVENANCE_MARKER,
  PROVENANCE_CONFORMANCE_TARGET,
  hasDeprecatedProvenanceMarker,
} from './schema.js';
import {
  PROVENANCE_REQUIREMENTS,
  obligationFor,
  type NormalizedManifest,
  type Obligation,
  type RequirementEvaluation,
} from './requirements.js';

/**
 * `provenance` validator layer — `bio-prov` v0.2 (spec section 8).
 *
 * Issue codes:
 *   `provenance.missing.<id>`                the property is absent
 *   `provenance.invalid.<id>[.<field>]`      present but malformed
 *   `provenance.mismatch.<id>.<field>`       disagrees with another property
 *   `provenance.deprecated.marker`           opted in with `bio:provenanceProfile`
 *   `provenance.deprecated.activityKind`     a `bio:activityKind` is still present
 *
 * The two `deprecated` codes are not requirements: they are warnings at
 * every tier, in strict and permissive mode alike, telling the author to
 * migrate to the v0.2 mechanics (spec section 13).
 *
 * Levels follow the enforcement rule of spec section 3 for the tier the
 * caller passes (`OPEN` when none is given). The layer is **strict** by
 * default (`strict: true`, since #504) and applies the table as written:
 * MUST → `error`, SHOULD → `warning`, MAY → never reported; a property
 * that is present but malformed is an `error` at every tier. The
 * permissive reading stays available behind `strict: false`: every
 * obligation is reported one level down, so a MUST that is not met is a
 * `warning`, a SHOULD is not reported at all (`ValidationLevel` has only
 * `error` and `warning`), and a malformed property is a `warning`.
 */

export interface ProvenanceValidationOptions {
  /** The dataset's catalogue access tier (ADR-0003). Defaults to `OPEN`. */
  accessTier?: AccessTier;
  /** Apply the obligation table as written. Defaults to `true`; `false` is permissive. */
  strict?: boolean;
}

/** One requirement's outcome together with its effective obligation at the tier. */
export interface ProvenanceRequirementReport extends RequirementEvaluation {
  obligation: Obligation;
}

export interface ProvenanceValidation {
  accessTier: AccessTier;
  strict: boolean;
  issues: ValidationIssue[];
  /** Every requirement's outcome, including satisfied and not-applicable ones. */
  report: ProvenanceRequirementReport[];
}

/**
 * Level for a `missing` outcome. `null` means "not reported".
 */
function levelForMissing(obligation: Obligation, strict: boolean): ValidationLevel | null {
  if (strict) {
    if (obligation === 'MUST') return 'error';
    if (obligation === 'SHOULD') return 'warning';
    return null;
  }
  return obligation === 'MUST' ? 'warning' : null;
}

/** Level for a present-but-malformed property, tier-independent. */
function levelForMalformed(strict: boolean): ValidationLevel {
  return strict ? 'error' : 'warning';
}

/**
 * Validate the `bio-prov` obligations of a **normalized** manifest and
 * return the issues plus the per-requirement report. `validate()` in
 * `validator/index.ts` calls this only when `provenanceProfile` is present.
 */
export function validateProvenanceDetailed(
  normalized: NormalizedManifest,
  options: ProvenanceValidationOptions = {},
): ProvenanceValidation {
  const accessTier: AccessTier = options.accessTier ?? 'OPEN';
  const strict = options.strict ?? true;
  const issues: ValidationIssue[] = [];
  const report: ProvenanceRequirementReport[] = [];

  if (hasDeprecatedProvenanceMarker(normalized)) {
    issues.push({
      path: `/${DEPRECATED_PROVENANCE_MARKER}`,
      level: 'warning',
      code: 'provenance.deprecated.marker',
      message: `bio:provenanceProfile is deprecated: declare "${PROVENANCE_CONFORMANCE_TARGET}" in dct:conformsTo instead`,
    });
  }
  issues.push(...deprecatedActivityKindIssues(normalized));

  for (const requirement of PROVENANCE_REQUIREMENTS) {
    const obligation = obligationFor(requirement, accessTier, normalized);
    for (const evaluation of requirement.evaluate(normalized)) {
      report.push({ ...evaluation, obligation });

      if (evaluation.status === 'missing') {
        const level = levelForMissing(obligation, strict);
        if (level === null) continue;
        issues.push({
          path: evaluation.path,
          level,
          code: `provenance.missing.${evaluation.id}`,
          message: `${evaluation.id} (${requirement.title}) is a ${obligation} at ${accessTier}: ${evaluation.message}`,
        });
      } else if (evaluation.status === 'malformed') {
        for (const problem of evaluation.problems) {
          const suffix = problem.field ? `.${problem.field}` : '';
          issues.push({
            path: problem.path,
            level: levelForMalformed(strict),
            code: `provenance.${problem.kind}.${evaluation.id}${suffix}`,
            message: `${evaluation.id} (${requirement.title}): ${problem.message}`,
          });
        }
      }
    }
  }

  return { accessTier, strict, issues, report };
}

/**
 * v0.1's `bio:activityKind`, wherever it sits (dataset-level activity,
 * write-back activity, a nested one). Reported once per occurrence with
 * its own pointer so the author can find each of them.
 */
function deprecatedActivityKindIssues(node: unknown, path = ''): ValidationIssue[] {
  if (Array.isArray(node)) {
    return node.flatMap((child, i) => deprecatedActivityKindIssues(child, `${path}/${i}`));
  }
  if (node === null || typeof node !== 'object') return [];
  const issues: ValidationIssue[] = [];
  for (const [key, value] of Object.entries(node)) {
    const childPath = `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
    if (key === DEPRECATED_ACTIVITY_KIND_PROPERTY) {
      issues.push({
        path: childPath,
        level: 'warning',
        code: 'provenance.deprecated.activityKind',
        message:
          'bio:activityKind is removed in bio-prov v0.2: type the activity with a dpv/ai activity type in @type instead',
      });
      continue;
    }
    issues.push(...deprecatedActivityKindIssues(value, childPath));
  }
  return issues;
}

/**
 * Validate the `bio-prov` obligations of a **normalized** manifest.
 * Returns only the issues; see `validateProvenanceDetailed` for the
 * per-requirement report.
 */
export function validateProvenance(
  normalized: NormalizedManifest,
  options: ProvenanceValidationOptions = {},
): ValidationIssue[] {
  return validateProvenanceDetailed(normalized, options).issues;
}
