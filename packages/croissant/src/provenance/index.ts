import type { AccessTier } from '@oci/shared-types';
import type { ValidationIssue, ValidationLevel } from '../validator/index.js';
import { PROVENANCE_PROFILE_VERSION } from './schema.js';
import {
  PROVENANCE_REQUIREMENTS,
  obligationFor,
  type NormalizedManifest,
  type Obligation,
  type RequirementEvaluation,
} from './requirements.js';

/**
 * `provenance` validator layer — `bio-prov` v0.1 (spec section 8).
 *
 * Issue codes:
 *   `provenance.missing.<id>`               the property is absent
 *   `provenance.invalid.<id>[.<field>]`     present but malformed
 *   `provenance.mismatch.<id>.<field>`      disagrees with another property
 *   `provenance.invalid.provenanceProfile`  the marker is not `bio-prov/0.1`
 *
 * Levels follow the enforcement rule of spec section 3 for the tier the
 * caller passes (`OPEN` when none is given). The layer ships **permissive**
 * (`strict: false`, the default): every obligation is reported one level
 * down, so a MUST that is not met is a `warning` and a SHOULD is not
 * reported at all — `ValidationLevel` has only `error` and `warning`. A
 * later change flips `strict` on and applies the table as written: MUST →
 * `error`, SHOULD → `warning`, MAY → never reported. A property that is
 * present but malformed is an `error` at every tier in strict mode and a
 * `warning` in permissive mode.
 */

export interface ProvenanceValidationOptions {
  /** The dataset's catalogue access tier (ADR-0003). Defaults to `OPEN`. */
  accessTier?: AccessTier;
  /** Apply the obligation table as written. Defaults to `false` (permissive). */
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
  const strict = options.strict ?? false;
  const issues: ValidationIssue[] = [];
  const report: ProvenanceRequirementReport[] = [];

  const marker = normalized['provenanceProfile'];
  if (marker !== PROVENANCE_PROFILE_VERSION) {
    issues.push({
      path: '/provenanceProfile',
      level: levelForMalformed(strict),
      code: 'provenance.invalid.provenanceProfile',
      message: `provenanceProfile must be "${PROVENANCE_PROFILE_VERSION}" (got ${JSON.stringify(marker)})`,
    });
  }

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
