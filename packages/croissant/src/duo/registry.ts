/**
 * GA4GH Data Use Ontology (DUO) — minimal term registry.
 *
 * Sourced from EBISPOT/DUO (https://github.com/EBISPOT/DUO). Hand-
 * picked subset — the full ontology has ~30 terms, this file carries
 * the ones that meaningfully appear on health datasets and against
 * which we can mechanically match a requester's intended use.
 *
 * Term identifiers are OBO-style (`DUO_0000004`); the canonical IRI
 * is `http://purl.obolibrary.org/obo/<id>`. Both forms are acceptable
 * in a Croissant manifest's `cr:dataUseTerms` array; the validator
 * normalises to OBO ids.
 *
 * Categories:
 *   - `permission`  — broad permission to use the data (GRU, HMB, …).
 *     A dataset typically declares ONE permission term.
 *   - `restriction` — narrows what's permitted (NCU, GSO, …). Multiple
 *     restrictions can stack.
 *   - `modifier`    — additional steps required (IRB, PUB, COL, RTN, …).
 *
 * The matcher (apps/api/.../duo-matcher.ts) reads `category` +
 * `commercialUseAllowed` + `requiresIrb` to decide
 * MATCHED/CONFLICT/UNCLEAR. Adding a term with a new semantic axis
 * means extending both this registry and the matcher together.
 */

export type DuoCategory = 'permission' | 'restriction' | 'modifier';

export interface DuoTerm {
  /** OBO id, e.g. `DUO_0000042`. */
  id: string;
  /** Short code from the GA4GH paper, e.g. `GRU`. Used in UI badges. */
  code: string;
  /** Human label, displayed under the code. */
  label: string;
  /** One-line plain-English summary. */
  summary: string;
  category: DuoCategory;
  /**
   * Whether commercial use is allowed under this term. `null` for
   * modifiers and for permissions where the term is silent on
   * commercial use (the matcher then defers to other terms in the
   * same set).
   */
  commercialUseAllowed: boolean | null;
  /**
   * Whether the term explicitly requires an Institutional Review
   * Board (or equivalent ethics committee) approval. The matcher
   * will reject requests that don't carry an IRB ref.
   */
  requiresIrb: boolean;
  /**
   * Whether the term requires a formal data-use agreement (DUA) at
   * approval time. Out of scope for J.1 (matcher just flags it as
   * `UNCLEAR` so the host knows a DUA is needed); J.2 will wire DUA
   * generation + e-sign.
   */
  requiresFormalAgreement: boolean;
}

const DUO_OBO_PREFIX = 'http://purl.obolibrary.org/obo/';

/**
 * Resolve a DUO IRI or short id to its registry entry. Manifests in
 * the wild use either form — we normalise to the OBO id internally.
 */
export function lookupDuoTerm(iriOrId: string): DuoTerm | null {
  const id = iriOrId.startsWith(DUO_OBO_PREFIX)
    ? iriOrId.slice(DUO_OBO_PREFIX.length)
    : iriOrId;
  return DUO_REGISTRY.find((t) => t.id === id) ?? null;
}

/** True iff the input looks like a DUO id or full IRI we recognise. */
export function isKnownDuoTerm(iriOrId: string): boolean {
  return lookupDuoTerm(iriOrId) !== null;
}

/** Canonicalise to OBO short id; pass through unrecognised inputs. */
export function normaliseDuoId(iriOrId: string): string {
  return iriOrId.startsWith(DUO_OBO_PREFIX)
    ? iriOrId.slice(DUO_OBO_PREFIX.length)
    : iriOrId;
}

export const DUO_REGISTRY: readonly DuoTerm[] = [
  // --- Permissions -------------------------------------------------------
  {
    id: 'DUO_0000042',
    code: 'GRU',
    label: 'General research use',
    summary:
      'Use is limited to research of any type, with no further restrictions on the research domain.',
    category: 'permission',
    commercialUseAllowed: true,
    requiresIrb: false,
    requiresFormalAgreement: false,
  },
  {
    id: 'DUO_0000006',
    code: 'HMB',
    label: 'Health, medical or biomedical research',
    summary: 'Use is limited to health, medical, or biomedical research.',
    category: 'permission',
    commercialUseAllowed: true,
    requiresIrb: false,
    requiresFormalAgreement: false,
  },
  {
    id: 'DUO_0000007',
    code: 'DS',
    label: 'Disease specific research',
    summary:
      'Use is limited to research on a specific disease (the disease is named alongside the term).',
    category: 'permission',
    commercialUseAllowed: true,
    requiresIrb: false,
    requiresFormalAgreement: false,
  },
  {
    id: 'DUO_0000011',
    code: 'POA',
    label: 'Population origins or ancestry research only',
    summary: 'Use is limited to population, origins, or ancestry research.',
    category: 'permission',
    commercialUseAllowed: true,
    requiresIrb: false,
    requiresFormalAgreement: false,
  },
  {
    id: 'DUO_0000004',
    code: 'NRES',
    label: 'No restriction',
    summary: 'No restrictions on data use.',
    category: 'permission',
    commercialUseAllowed: true,
    requiresIrb: false,
    requiresFormalAgreement: false,
  },

  // --- Restrictions ------------------------------------------------------
  {
    id: 'DUO_0000046',
    code: 'NCU',
    label: 'Non-commercial use only',
    summary: 'Use is limited to non-commercial purposes.',
    category: 'restriction',
    commercialUseAllowed: false,
    requiresIrb: false,
    requiresFormalAgreement: false,
  },
  {
    id: 'DUO_0000045',
    code: 'NPUNCU',
    label: 'Not for profit, non-commercial use only',
    summary: 'Use is limited to non-profit, non-commercial purposes.',
    category: 'restriction',
    commercialUseAllowed: false,
    requiresIrb: false,
    requiresFormalAgreement: false,
  },
  {
    id: 'DUO_0000016',
    code: 'GSO',
    label: 'Genetic studies only',
    summary: 'Use is limited to genetic studies (no other research types permitted).',
    category: 'restriction',
    commercialUseAllowed: null,
    requiresIrb: false,
    requiresFormalAgreement: false,
  },

  // --- Modifiers ---------------------------------------------------------
  {
    id: 'DUO_0000021',
    code: 'IRB',
    label: 'Ethics approval required',
    summary: 'Requester must hold approval from an institutional review board / ethics committee.',
    category: 'modifier',
    commercialUseAllowed: null,
    requiresIrb: true,
    requiresFormalAgreement: false,
  },
  {
    id: 'DUO_0000019',
    code: 'PUB',
    label: 'Publication required',
    summary: 'Use requires the requester to publish results.',
    category: 'modifier',
    commercialUseAllowed: null,
    requiresIrb: false,
    requiresFormalAgreement: false,
  },
  {
    id: 'DUO_0000020',
    code: 'COL',
    label: 'Collaboration required',
    summary: 'Use requires collaboration with the data provider / primary study investigators.',
    category: 'modifier',
    commercialUseAllowed: null,
    requiresIrb: false,
    requiresFormalAgreement: true,
  },
  {
    id: 'DUO_0000024',
    code: 'MOR',
    label: 'Publication moratorium',
    summary: 'A moratorium on publication applies until a date set by the data provider.',
    category: 'modifier',
    commercialUseAllowed: null,
    requiresIrb: false,
    requiresFormalAgreement: true,
  },
  {
    id: 'DUO_0000029',
    code: 'RTN',
    label: 'Return to database / resource',
    summary:
      'Derived data, annotations, and results must be returned to the originating database or resource.',
    category: 'modifier',
    commercialUseAllowed: null,
    requiresIrb: false,
    requiresFormalAgreement: true,
  },
  {
    id: 'DUO_0000026',
    code: 'US',
    label: 'User specific restriction',
    summary: 'Use is restricted to a specific named user.',
    category: 'modifier',
    commercialUseAllowed: null,
    requiresIrb: false,
    requiresFormalAgreement: true,
  },
  {
    id: 'DUO_0000027',
    code: 'PS',
    label: 'Project specific restriction',
    summary: 'Use is restricted to the project named in the original request.',
    category: 'modifier',
    commercialUseAllowed: null,
    requiresIrb: false,
    requiresFormalAgreement: true,
  },
  {
    id: 'DUO_0000028',
    code: 'IS',
    label: 'Institution specific restriction',
    summary: 'Use is restricted to the institution named in the original request.',
    category: 'modifier',
    commercialUseAllowed: null,
    requiresIrb: false,
    requiresFormalAgreement: true,
  },
] as const;
