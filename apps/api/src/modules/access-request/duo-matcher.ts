/**
 * DUO matcher (PR J.1, #93). Pure function — no DB, no IO.
 *
 * Given the dataset's DUO permission terms (extracted from the
 * manifest's `consentCode`) and the requester's intended use payload,
 * return one of:
 *
 *   - MATCHED — every requester-declared use is permitted by the
 *               dataset's terms; no formal-agreement modifier blocks
 *               approval; IRB-required terms are met.
 *   - CONFLICT — at least one explicit conflict (commercial use vs
 *               NCU dataset, no IRB on IRB-required dataset, etc.).
 *   - UNCLEAR — terms don't cleanly match (formal-agreement modifier
 *               like RTN/COL/MOR demands a DUA the platform doesn't
 *               yet generate, or one of the dataset terms isn't in
 *               our registry). Host reads explanations + decides.
 *
 * Explanations are plain English — the host inbox renders them
 * verbatim under the badge so a host who doesn't know DUO can still
 * make the call.
 *
 * The matcher is intentionally conservative. UNCLEAR is not a soft
 * MATCH — anything not provably matched stays UNCLEAR so the host
 * gets a real review prompt rather than a rubber-stamp.
 */

import { lookupDuoTerm, type DuoTerm } from '@oci/croissant';
import type {
  AccessRequestAttestations,
  AccessRequestMatchStatus,
  IntendedUseCategory,
} from '@oci/shared-types';

export interface MatchResult {
  status: AccessRequestMatchStatus;
  explanations: string[];
}

export function matchDuoIntent(
  datasetTermIds: readonly string[],
  attestations: AccessRequestAttestations,
): MatchResult {
  // No DUO terms declared on the dataset → unclear. The publish-time
  // fail-closed (catalog.service) prevents this on RESTRICTED/PRIVATE,
  // so this branch fires only for PUBLIC datasets that voluntarily
  // ran an access request through.
  if (datasetTermIds.length === 0) {
    return {
      status: 'UNCLEAR',
      explanations: ['Dataset declared no DUO terms — host must judge manually.'],
    };
  }

  const datasetTerms = datasetTermIds.map(lookupDuoTerm).filter((t): t is DuoTerm => t !== null);

  // Some manifest term wasn't in our registry. Don't pretend to know
  // — flag UNCLEAR so the host sees the unknown term and decides.
  if (datasetTerms.length !== datasetTermIds.length) {
    const unknown = datasetTermIds.filter((id) => !lookupDuoTerm(id));
    return {
      status: 'UNCLEAR',
      explanations: [
        `Dataset references DUO terms not in this platform's registry: ${unknown.join(', ')}. Host must judge manually.`,
      ],
    };
  }

  const conflicts: string[] = [];
  const unclear: string[] = [];

  // Commercial-use check.
  const commercial = isCommercialIntent(attestations.intendedUseCategory);
  for (const t of datasetTerms) {
    if (t.commercialUseAllowed === false && commercial) {
      conflicts.push(
        `Dataset is "${t.code} (${t.label})" — commercial use prohibited. Requester declared "${attestations.intendedUseCategory}".`,
      );
    }
  }

  // IRB modifier check.
  const irbRequired = datasetTerms.some((t) => t.requiresIrb);
  if (irbRequired && !attestations.irbApproved) {
    conflicts.push(
      'Dataset requires IRB / ethics approval but the requester did not attest to IRB approval.',
    );
  }

  // Formal-agreement modifiers (RTN, COL, MOR, US/PS/IS). Until PR
  // J.2 wires DUA generation we can't auto-discharge these — flag
  // UNCLEAR so the host knows a manual agreement step is needed.
  const formalAgreementTerms = datasetTerms.filter((t) => t.requiresFormalAgreement);
  if (formalAgreementTerms.length > 0) {
    for (const t of formalAgreementTerms) {
      unclear.push(
        `Dataset has "${t.code} (${t.label})" — needs a formal data-use agreement before approval. Platform DUA generation is queued for PR J.2.`,
      );
    }
  }

  // Permission-coverage check: does the requester's intended use
  // bucket fit any of the dataset's permission terms? GRU permits
  // anything; HMB permits health-AI; DS permits the named disease;
  // POA permits ancestry research only. NRES permits everything.
  const permissions = datasetTerms.filter((t) => t.category === 'permission');
  if (permissions.length > 0) {
    const covered = permissionCovers(permissions, attestations.intendedUseCategory);
    if (covered === 'no') {
      conflicts.push(
        `Requester's "${attestations.intendedUseCategory}" intent is outside the scope of the dataset's permission terms (${permissions.map((p) => p.code).join(', ')}).`,
      );
    } else if (covered === 'partial') {
      unclear.push(
        `Requester's "${attestations.intendedUseCategory}" intent is *partially* within the dataset's permission scope (${permissions.map((p) => p.code).join(', ')}). Host should confirm the use fits.`,
      );
    }
  }

  if (conflicts.length > 0) {
    return { status: 'CONFLICT', explanations: conflicts.concat(unclear) };
  }
  if (unclear.length > 0) {
    return { status: 'UNCLEAR', explanations: unclear };
  }
  return {
    status: 'MATCHED',
    explanations: [
      `Requester's intended use is consistent with the dataset's DUO terms (${datasetTerms.map((t) => t.code).join(', ')}).`,
    ],
  };
}

function isCommercialIntent(category: IntendedUseCategory): boolean {
  return category === 'COMMERCIAL_RESEARCH';
}

/**
 * For permission terms, reduce coverage to yes/partial/no for the
 * requester's intent bucket. Conservative: if no permission term
 * obviously covers the intent, return 'partial' rather than 'no' —
 * the matcher escalates to UNCLEAR (host review) rather than
 * CONFLICT (deny). NRES + GRU cover everything; HMB covers research;
 * DS covers research (the disease check is a v2 concern); POA covers
 * narrow research.
 */
function permissionCovers(
  permissions: readonly DuoTerm[],
  category: IntendedUseCategory,
): 'yes' | 'partial' | 'no' {
  for (const p of permissions) {
    switch (p.code) {
      case 'NRES':
      case 'GRU':
        return 'yes';
      case 'HMB':
        if (category === 'NON_COMMERCIAL_RESEARCH' || category === 'COMMERCIAL_RESEARCH') {
          return 'yes';
        }
        if (category === 'CLINICAL_CARE') return 'partial';
        return 'no';
      case 'DS':
        if (category === 'NON_COMMERCIAL_RESEARCH' || category === 'COMMERCIAL_RESEARCH') {
          // The dataset's disease vs requester's disease check needs
          // structured fields we don't yet collect. Flag partial so
          // the host eyeballs project description.
          return 'partial';
        }
        if (category === 'CLINICAL_CARE') return 'partial';
        return 'no';
      case 'POA':
        return 'partial';
      default:
        // Unknown permission code (shouldn't happen — caller filtered)
        return 'partial';
    }
  }
  return 'partial';
}
