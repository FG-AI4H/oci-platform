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

const ProvActivity = z
  .object({
    '@type': z.union([z.literal('prov:Activity'), z.literal('Activity')]),
    '@id': z.string().optional(),
    name: z.string().optional(),
    startedAtTime: z.string().optional(),
    endedAtTime: z.string().optional(),
    used: z.union([ProvEntityRef, z.array(ProvEntityRef)]).optional(),
    wasAssociatedWith: z
      .union([z.string(), ProvAgent, z.array(z.union([z.string(), ProvAgent]))])
      .optional(),
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

    // Usage policy
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
