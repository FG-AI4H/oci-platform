import { z } from 'zod';

/**
 * Croissant 1.1 deltas (Feb 2026).
 *
 * Layered on top of the 1.0 base schema — these properties are OPTIONAL
 * additions (1.1 is backwards-compatible). When `dct:conformsTo` is
 * "http://mlcommons.org/croissant/1.1" the validator runs both
 * Croissant10Schema AND this deltas schema; when it's 1.0 only the base
 * runs (any 1.1 properties present become passthrough warnings).
 *
 * Sources:
 *   - https://mlcommons.org/2026/02/croissant-1-1-standard/
 *   - github.com/mlcommons/croissant/blob/main/docs/croissant-spec-1.1.md
 *
 * Encoded against the **normalized** form (prefixes stripped). Pre-norm
 * inputs may use `prov:wasDerivedFrom`, `odrl:Permission`, `bio:`, etc.
 */

const Url = z.string().min(1);

// PROV-O — machine-actionable provenance (W3C PROV ontology subset).
//
// An upstream Entity a dataset `wasDerivedFrom` / an Activity `used`. A
// bare IRI string is accepted wherever an Entity may appear.
const ProvEntity = z
  .object({
    '@type': z.union([z.literal('prov:Entity'), z.literal('Entity')]).optional(),
    '@id': z.string().optional(),
    name: z.string().optional(),
  })
  .passthrough();

const ProvEntityRef = z.union([z.string(), ProvEntity]);

const ProvAgentBase = z
  .object({
    /**
     * `prov:hadRole` — the role the agent held in the activity
     * (`Annotator`, `Adjudicator`, ...). `bio-prov` v0.2 H6b requires it
     * on the agents of a labelling activity; roles, never identities.
     */
    hadRole: z.union([z.string(), z.array(z.string())]).optional(),
    '@type': z
      .union([
        z.literal('prov:Agent'),
        z.literal('prov:Person'),
        z.literal('prov:Organization'),
        z.literal('prov:SoftwareAgent'),
        z.literal('Agent'),
        z.literal('Person'),
        z.literal('Organization'),
        z.literal('SoftwareAgent'),
      ])
      .optional(),
    '@id': z.string().optional(),
    name: z.string().optional(),
  })
  .passthrough();

// One level of delegation (`prov:actedOnBehalfOf`) — a SoftwareAgent
// acting for an Organization is the common dataset-level case.
const ProvAgent = ProvAgentBase.extend({
  actedOnBehalfOf: z
    .union([z.string(), ProvAgentBase, z.array(z.union([z.string(), ProvAgentBase]))])
    .optional(),
});

/**
 * An activity's `@type`. A bare `prov:Activity`, or an array that carries
 * it alongside a Data Privacy Vocabulary AI activity type
 * (`https://w3id.org/dpv/ai#DataCollection` / `#DataLabelling`) — the
 * double typing the Croissant RAI specification uses and `bio-prov` v0.2
 * keys H2, H6b and A1 on.
 */
const ProvActivityType = z.union([
  z.literal('prov:Activity'),
  z.literal('Activity'),
  z
    .array(z.string())
    .refine(
      (types) => types.includes('prov:Activity') || types.includes('Activity'),
      'expected prov:Activity among the activity @type values',
    ),
]);

const ProvActivity = z
  .object({
    '@type': ProvActivityType,
    '@id': z.string().optional(),
    name: z.string().optional(),
    /** An instant, the RAI specification's own form. Alternative to the two bounds. */
    atTime: z.string().optional(),
    startedAtTime: z.string().optional(),
    endedAtTime: z.string().optional(),
    used: z.union([ProvEntityRef, z.array(ProvEntityRef)]).optional(),
    wasAssociatedWith: z
      .union([z.string(), ProvAgent, z.array(z.union([z.string(), ProvAgent]))])
      .optional(),
    /**
     * `prov:qualifiedAssociation` — the qualified form of an association
     * (agent + role as a `prov:Association` node). Accepted and passed
     * through; `bio-prov` v0.2 reads roles off the agents themselves.
     */
    qualifiedAssociation: z.unknown().optional(),
  })
  .passthrough();

// ODRL — usage policy expression (W3C Open Digital Rights Language subset).
const OdrlConstraint = z
  .object({
    leftOperand: z.string().optional(),
    operator: z.string().optional(),
    rightOperand: z.union([z.string(), z.number(), z.array(z.string())]).optional(),
  })
  .passthrough();

const OdrlDuty = z
  .object({
    action: z.union([z.string(), z.array(z.string())]).optional(),
    target: z.string().optional(),
    constraint: z.union([OdrlConstraint, z.array(OdrlConstraint)]).optional(),
  })
  .passthrough();

const OdrlPermission = OdrlDuty.extend({
  // A duty attached to the permission (`odrl:attribute` for CC BY).
  duty: z.union([OdrlDuty, z.array(OdrlDuty)]).optional(),
});

const OdrlOffer = z
  .object({
    '@type': z.union([z.literal('odrl:Offer'), z.literal('Offer')]),
    '@id': z.string().optional(),
    permission: z.union([OdrlPermission, z.array(OdrlPermission)]).optional(),
    prohibition: z.union([OdrlPermission, z.array(OdrlPermission)]).optional(),
    obligation: z.union([OdrlPermission, z.array(OdrlPermission)]).optional(),
  })
  .passthrough();

/**
 * A policy node hanging off schema.org `usageInfo` — the attachment point
 * every ODRL example in the Croissant Responsible AI specification uses,
 * and the preferred one in `bio-prov` v0.2 (§5.5). `@type` is typically
 * `["CreativeWork", "odrl:Set"]`, sometimes an `odrl:Offer`; the optional
 * `odrl:profile` points at an ODRL profile such as the W3C ODRL AI
 * vocabulary. Croissant 1.1's `hasOffer` stays accepted below.
 */
const POLICY_TYPES: ReadonlyArray<string> = [
  'odrl:Set',
  'Set',
  'odrl:Offer',
  'Offer',
  'odrl:Agreement',
  'Agreement',
  'odrl:Policy',
  'Policy',
];

const UsageInfoPolicy = z
  .object({
    '@type': z
      .union([z.string(), z.array(z.string())])
      .refine(
        (t) => (Array.isArray(t) ? t : [t]).some((x) => POLICY_TYPES.includes(x)),
        'expected an ODRL policy type (odrl:Set, odrl:Offer, ...) among the usageInfo @type values',
      ),
    '@id': z.string().optional(),
    profile: z.union([Url, z.array(Url)]).optional(),
    permission: z.union([OdrlPermission, z.array(OdrlPermission)]).optional(),
    prohibition: z.union([OdrlPermission, z.array(OdrlPermission)]).optional(),
    obligation: z.union([OdrlPermission, z.array(OdrlPermission)]).optional(),
  })
  .passthrough();

// DUO — Data Use Ontology consent codes carried as DefinedTerm references.
const DefinedTerm = z
  .object({
    '@type': z.union([z.literal('sc:DefinedTerm'), z.literal('DefinedTerm')]).optional(),
    '@id': z.string().optional(),
    name: z.string().optional(),
    termCode: z.string().optional(),
    inDefinedTermSet: Url.optional(),
  })
  .passthrough();

/**
 * 1.1 deltas, all optional. Validation runs alongside Croissant10Schema.
 */
export const Croissant11DeltasSchema = z
  .object({
    // Provenance
    wasDerivedFrom: z.union([ProvEntityRef, z.array(ProvEntityRef)]).optional(),
    wasGeneratedBy: z
      .union([z.string(), ProvActivity, z.array(z.union([z.string(), ProvActivity]))])
      .optional(),
    wasAttributedTo: z
      .union([z.string(), ProvAgent, z.array(z.union([z.string(), ProvAgent]))])
      .optional(),

    // Usage policy — `usageInfo` (preferred, bio-prov v0.2 §5.5) or
    // Croissant 1.1's `hasOffer`. Both are accepted; a manifest may carry
    // either or both.
    usageInfo: z.union([UsageInfoPolicy, z.array(UsageInfoPolicy)]).optional(),
    hasOffer: z.union([OdrlOffer, z.array(OdrlOffer)]).optional(),
    /**
     * Convenience top-level for the most common case: a list of DUO
     * consent codes ("DUO_0000006" Health/Medical, "DUO_0000018"
     * Non-commercial, etc.). Encoded as DefinedTerm references.
     */
    consentCode: z.union([DefinedTerm, z.array(DefinedTerm)]).optional(),

    // Vocabulary framework — equivalentProperty / inDefinedTermSet are
    // applied at the Field level inside recordSet[]; here we just expose
    // the helper types.
  })
  .passthrough();

export type Croissant11Deltas = z.infer<typeof Croissant11DeltasSchema>;
