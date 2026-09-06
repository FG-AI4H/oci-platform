import type { AccessTier } from '@oci/shared-types';
import { PROVENANCE_REQUIREMENTS, type Obligation, type RequirementId } from '@oci/croissant';

/**
 * Shaping of `provenance.*` validator issues for the publish wizard
 * (bio-prov v0.1, #496). Pure module — imported by the server action and
 * by the client-side step, so both render the same headline for the same
 * issue: "H5 · Ethics approval (IRB) is required for a SENSITIVE dataset".
 */

/** One `provenance.*` issue, ready to render inline on the wizard. */
export interface ProvenanceIssue {
  /** `P1`…`H6`, or `A1`…`A3`; null for the profile-marker check. */
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
  H2: 'Collection timeframe',
  H3: 'Acquisition device or scanner class',
  H4: 'De-identification activity',
  H5: 'Ethics approval (IRB, institutional review board)',
  H6: 'Label-production protocol',
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
  const label = id ? REQUIREMENT_LABEL[id] : 'Provenance profile marker';
  const prefix = id ? `${id} · ` : '';
  const kind = issue.code.split('.')[1];
  let headline: string;
  if (kind === 'missing') {
    const obligation = issue.level === 'error' ? 'required' : 'recommended';
    headline = `${prefix}${label} is ${obligation} for a ${tier} dataset`;
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
