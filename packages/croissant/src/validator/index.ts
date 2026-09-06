import { z } from 'zod';
import type { AccessTier } from '@oci/shared-types';
import { CONFORMS_TO } from '../namespaces/index.js';
import { Croissant10Schema, type Croissant10 } from '../croissant10/schema.js';
import { Croissant11DeltasSchema } from '../croissant11/schema.js';
import { RaiExtensionSchema, RAI_PROPERTIES } from '../rai/schema.js';
import { BioCroissantSchema, BIOCROISSANT_PROPERTIES } from '../biocroissant/schema.js';
import { PROVENANCE_PROFILE_PROPERTY } from '../provenance/schema.js';
import { validateProvenance } from '../provenance/index.js';
import { normalize } from './normalize.js';

export type ValidationLevel = 'error' | 'warning';

export interface ValidationIssue {
  /** RFC 6901 JSON Pointer into the original (pre-normalised) document. */
  path: string;
  level: ValidationLevel;
  /**
   * Stable error code, prefixed with the layer emitting it:
   *   `croissant10.missing.required.<field>`
   *   `croissant10.invalid.type.<field>`
   *   `croissant11.invalid.<field>`
   *   `rai.invalid.<field>`
   *   `biocroissant.invalid.<field>`
   *   `provenance.missing.<id>` / `provenance.invalid.<id>[.<field>]` /
   *   `provenance.mismatch.<id>.<field>`
   *   `validator.unsupported.conformance`
   */
  code: string;
  message: string;
}

export type Conformance = 'croissant-1.0' | 'croissant-1.1' | 'unknown';

export interface ValidationResult {
  ok: boolean;
  conformance: Conformance;
  hasRai: boolean;
  hasBioCroissant: boolean;
  /** `bio:provenanceProfile` present — the `bio-prov` layer ran (ADR-0022). */
  hasProvenanceProfile: boolean;
  issues: ValidationIssue[];
  /** The normalised manifest if base parsing succeeded. */
  data?: Croissant10;
}

export interface ValidateOptions {
  /**
   * The dataset's catalogue access tier (ADR-0003). Drives the
   * `bio-prov` obligations (spec section 3). Defaults to `OPEN`.
   */
  accessTier?: AccessTier;
  /**
   * Apply the `bio-prov` obligation table as written (spec section 3):
   * MUST → error, SHOULD → warning, MAY never reported; a present but
   * malformed value is an error at every tier. Defaults to `true`
   * (#504). Pass `false` for the permissive reading, one level down:
   * MUST → warning, SHOULD omitted, malformed → warning. Only consulted
   * when the manifest carries `bio:provenanceProfile`.
   */
  strictProvenance?: boolean;
}

/**
 * Validate a Croissant manifest in any prefix flavour.
 *
 * Layered: detects `dct:conformsTo` to pick base schema (1.0 or 1.1+),
 * then runs RAI, BIOCroissant and `bio-prov` provenance deltas as
 * optional layers. Issues from each layer are tagged with stable codes so
 * callers (UI, audit log, CI gating) can treat them differently.
 *
 * The `bio-prov` layer runs only when the manifest opts in with
 * `bio:provenanceProfile`, at the obligations of `options.accessTier`
 * (`OPEN` when none is given) and strict by default. Callers that
 * validate for publish must pass the dataset's catalogue tier: the
 * obligations differ per tier, and a manifest that is conformant at
 * `OPEN` can be rejected at `SENSITIVE`.
 */
export function validate(input: unknown, options: ValidateOptions = {}): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      conformance: 'unknown',
      hasRai: false,
      hasBioCroissant: false,
      hasProvenanceProfile: false,
      issues: [
        {
          path: '',
          level: 'error',
          code: 'validator.input.not_object',
          message: 'Manifest must be a JSON object',
        },
      ],
    };
  }

  const normalized = normalize(input) as Record<string, unknown>;
  const conformance = detectConformance(normalized);

  if (conformance === 'unknown') {
    issues.push({
      path: '/dct:conformsTo',
      level: 'error',
      code: 'validator.unsupported.conformance',
      message: `dct:conformsTo missing or unsupported. Expected "${CONFORMS_TO.croissant10}" or "${CONFORMS_TO.croissant11}".`,
    });
  }

  // Base layer
  const baseResult = Croissant10Schema.safeParse(normalized);
  if (!baseResult.success) {
    issues.push(...zodIssues(baseResult.error, 'croissant10'));
  }

  // 1.1 deltas — run on every input but only fail at error level when
  // conformance is 1.1 (1.0 manifests carrying 1.1 properties surface
  // as warnings, not errors).
  const v11Result = Croissant11DeltasSchema.safeParse(normalized);
  if (!v11Result.success) {
    const level: ValidationLevel = conformance === 'croissant-1.1' ? 'error' : 'warning';
    issues.push(...zodIssues(v11Result.error, 'croissant11', level));
  }

  // RAI / BIOCroissant — only validate the layers when the manifest opts in.
  const hasRai = RAI_PROPERTIES.some((p) => p in normalized);
  if (hasRai) {
    const raiResult = RaiExtensionSchema.safeParse(normalized);
    if (!raiResult.success) issues.push(...zodIssues(raiResult.error, 'rai'));
  }

  const hasBioCroissant = BIOCROISSANT_PROPERTIES.some((p) => p in normalized);
  if (hasBioCroissant) {
    const bioResult = BioCroissantSchema.safeParse(normalized);
    if (!bioResult.success) issues.push(...zodIssues(bioResult.error, 'biocroissant'));
  }

  // bio-prov — only when the manifest opts in with the profile marker.
  const hasProvenanceProfile = PROVENANCE_PROFILE_PROPERTY in normalized;
  if (hasProvenanceProfile) {
    issues.push(
      ...validateProvenance(normalized, {
        accessTier: options.accessTier ?? 'OPEN',
        strict: options.strictProvenance ?? true,
      }),
    );
  }

  const ok = issues.every((i) => i.level !== 'error');

  return {
    ok,
    conformance,
    hasRai,
    hasBioCroissant,
    hasProvenanceProfile,
    issues,
    data: baseResult.success ? baseResult.data : undefined,
  };
}

function detectConformance(normalized: Record<string, unknown>): Conformance {
  // After normalization, `dct:conformsTo` becomes `conformsTo`.
  const value = normalized['conformsTo'];
  if (value === CONFORMS_TO.croissant10) return 'croissant-1.0';
  if (value === CONFORMS_TO.croissant11) return 'croissant-1.1';
  return 'unknown';
}

/** Zod path → RFC 6901 JSON Pointer. */
function pointer(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) return '';
  return (
    '/' +
    path
      .map((p) => String(p))
      .map((p) => p.replaceAll('~', '~0').replaceAll('/', '~1'))
      .join('/')
  );
}

function zodIssues(
  err: z.ZodError,
  layer: 'croissant10' | 'croissant11' | 'rai' | 'biocroissant',
  override?: ValidationLevel,
): ValidationIssue[] {
  return err.issues.map((issue) => ({
    path: pointer(issue.path),
    level: override ?? 'error',
    code: zodCode(layer, issue),
    message: issue.message,
  }));
}

function zodCode(layer: string, issue: z.core.$ZodIssue): string {
  const last = issue.path.length > 0 ? String(issue.path[issue.path.length - 1]) : 'root';

  if (isMissingRequired(issue)) return `${layer}.missing.required.${last}`;

  // Map common Zod issue kinds to stable suffix codes.
  switch (issue.code) {
    case 'invalid_type':
      return `${layer}.invalid.type.${last}`;
    case 'invalid_value':
      return `${layer}.invalid.value.${last}`;
    case 'invalid_format':
      return `${layer}.invalid.format.${last}`;
    case 'too_small':
    case 'too_big':
      return `${layer}.invalid.size.${last}`;
    default:
      return `${layer}.invalid.${last}`;
  }
}

/**
 * Detect a "missing required field" in Zod v4's various failure shapes:
 *
 *   - Plain field (`z.string()`): `invalid_type` with message ending
 *     "received undefined". v4 has no separate `received` property.
 *   - Field declared as `z.union([...])` (e.g. license, creator): top
 *     level surfaces `invalid_union`. Each branch is its own array of
 *     issues, and a branch's first issue may itself be an
 *     `invalid_union` (when the branch type is a union, e.g. PersonOrOrg
 *     accepts a string or an object). Recurse through the tree: a
 *     "missing required" is one where every leaf failure is
 *     `invalid_type` with "received undefined".
 */
function isMissingRequired(issue: z.core.$ZodIssue): boolean {
  if (issue.code === 'invalid_type' && issue.message.endsWith('received undefined')) {
    return true;
  }
  if (issue.code === 'invalid_union') {
    const subs = (issue as unknown as { errors?: z.core.$ZodIssue[][] }).errors;
    if (subs && subs.length > 0) {
      return subs.every((branch) => branch.length > 0 && branch.every(isMissingRequired));
    }
  }
  return false;
}
