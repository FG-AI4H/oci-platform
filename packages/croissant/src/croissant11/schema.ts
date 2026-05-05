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
const ProvAgent = z
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

const ProvActivity = z
  .object({
    '@type': z.union([z.literal('prov:Activity'), z.literal('Activity')]),
    '@id': z.string().optional(),
    startedAtTime: z.string().optional(),
    endedAtTime: z.string().optional(),
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

const OdrlPermission = z
  .object({
    action: z.union([z.string(), z.array(z.string())]).optional(),
    target: z.string().optional(),
    constraint: z.union([OdrlConstraint, z.array(OdrlConstraint)]).optional(),
  })
  .passthrough();

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
    wasDerivedFrom: z.union([z.string(), z.array(z.string())]).optional(),
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
