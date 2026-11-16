import type { AccessTier } from '@oci/shared-types';
import { PROVENANCE_REQUIREMENTS, type Obligation, type RequirementId } from '@oci/croissant';

/**
 * Shaping of `provenance.*` validator issues for the publish wizard
 * (bio-prov v0.2, #496, #519). Pure module — imported by the server action and
 * by the client-side step, so both render the same headline for the same
 * issue: "H5 · Ethics approval (IRB) is required for a SENSITIVE dataset".
 */

/** One `provenance.*` issue, ready to render inline on the wizard. */
export interface ProvenanceIssue {
  /** `P1`…`H6b`, or `A1`…`A3`; null for the deprecation notices. */
  requirementId: RequirementId | null;
  /** Stable validator code, e.g. `provenance.missing.H5`. */
  code: string;
  /** RFC 6901 pointer into the normalised manifest. */
  path: string;
  level: 'error' | 'warning';
  /** "H5 · Ethics approval (IRB) is required for a SENSITIVE dataset". */
  headline: string;
  /** The validator's own message, for the detail line. */
  detail: string;
}

/** Plain-language names for the requirement ids, expanding acronyms once. */
export const REQUIREMENT_LABEL: Readonly<Record<RequirementId, string>> = {
  P1: 'Source organisation',
  P2: 'Dated collection or derivation activity',
  P3: 'Upstream dataset this one was derived from',
  P4: 'Agent that ran the collection',
  H1: 'Source sites with countries',
  H2: 'Date of the collection or derivation activity',
  H3: 'Acquisition device or scanner class',
  H4: 'De-identification activity',
  H5: 'Ethics approval (IRB, institutional review board)',
  H6: 'Label-production protocol',
  H6b: 'Annotation activity: guideline used and annotator roles',
  A1: 'Annotation write-back as a derived entity',
  A2: 'Annotation write-back hash-chain root',
  A3: 'Annotation write-back receipt references',
};

/** How the wizard words an obligation next to a field group. */
export const OBLIGATION_LABEL: Readonly<Record<Obligation, string>> = {
  MUST: 'Required',
  SHOULD: 'Recommended',
  MAY: 'Optional',
};

const REQUIREMENT_IDS = new Set<string>(PROVENANCE_REQUIREMENTS.map((r) => r.id));

/**
 * Codes that are not requirements: the v0.1 mechanics the profile still
 * accepts and reports as warnings (bio-prov v0.2 section 2).
 */
const DEPRECATION_LABEL: ReadonlyMap<string, string> = new Map([
  ['provenance.deprecated.marker', 'The bio:provenanceProfile marker'],
  ['provenance.deprecated.activityKind', 'The bio:activityKind property'],
]);

export function isProvenanceCode(code: string | undefined): code is string {
  return typeof code === 'string' && code.startsWith('provenance.');
}

/** `provenance.<kind>.<id>[.<field>]` → the requirement id, if the code names one. */
export function requirementIdOf(code: string): RequirementId | null {
  const id = code.split('.')[2] ?? '';
  return REQUIREMENT_IDS.has(id) ? (id as RequirementId) : null;
}

/**
 * Turn one validator issue into the wizard's inline shape. `level` is the
 * level the validator reported; the headline's wording follows it
 * (`error` on a missing block → "required", `warning` → "recommended").
 */
export function describeProvenanceIssue(
  issue: { code: string; path?: string; message: string; level: 'error' | 'warning' },
  tier: AccessTier,
): ProvenanceIssue {
  const id = requirementIdOf(issue.code);
  // `id` is a member of the closed RequirementId union (checked above).
  // eslint-disable-next-line security/detect-object-injection
  const requirementLabel = id ? REQUIREMENT_LABEL[id] : null;
  const label =
    requirementLabel ?? DEPRECATION_LABEL.get(issue.code) ?? 'Provenance profile opt-in';
  const prefix = id ? `${id} · ` : '';
  const kind = issue.code.split('.')[1];
  let headline: string;
  if (kind === 'missing') {
    const obligation = issue.level === 'error' ? 'required' : 'recommended';
    headline = `${prefix}${label} is ${obligation} for a ${tier} dataset`;
  } else if (kind === 'deprecated') {
    headline = `${prefix}${label} is deprecated in bio-prov v0.2`;
  } else if (kind === 'mismatch') {
    headline = `${prefix}${label} disagrees with another field`;
  } else {
    headline = `${prefix}${label} is present but incomplete or malformed`;
  }
  return {
    requirementId: id,
    code: issue.code,
    path: issue.path ?? '',
    level: issue.level,
    headline,
    detail: issue.message,
  };
}
