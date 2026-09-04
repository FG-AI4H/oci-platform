import { z } from 'zod';
import { Croissant11DeltasSchema } from '../croissant11/schema.js';

/**
 * `bio-prov` v0.1 — health-dataset provenance profile (ADR-0022,
 * `docs/standards/bio-prov-v0.1.md`).
 *
 * Encoded against the **normalized** form (prefixes stripped — see
 * validator/normalize.ts): `bio:provenanceProfile` → `provenanceProfile`,
 * `prov:wasGeneratedBy` → `wasGeneratedBy`, `prov:startedAtTime` →
 * `startedAtTime`. `@type` values keep their prefix (`prov:Activity`).
 *
 * Two kinds of shape live here:
 *
 *   - The PROV-O properties the profile *constrains* (P1–P4) are the
 *     Croissant 1.1 shapes, picked from `Croissant11DeltasSchema` so that
 *     they are defined once. The profile's constraints on them (an
 *     Organization with a name, a dated Activity, ...) are obligations
 *     that depend on the access tier and are enforced by
 *     `requirements.ts`, not by Zod `required`.
 *   - The terms the profile *adds* under `bio:` (`sourceSite`,
 *     `deviceClass`, `deidentification`, `labelProtocol`; `integrity` and
 *     `receipts` on write-back distributions). Each is optional at the
 *     top level; when one is present its minimum fields are required so
 *     that a present-but-incomplete object is reported as malformed.
 *
 * All objects are `.passthrough()`: the layer never fails a manifest for
 * extra properties (spec section 8).
 */

export const PROVENANCE_PROFILE_VERSION = 'bio-prov/0.1' as const;

const NonEmptyString = z.string().min(1);
const CountryCode = z.string().regex(/^[A-Z]{2}$/, 'expected ISO 3166-1 alpha-2');

/**
 * ISO 8601 calendar date (`2024-05-02`) or date-time
 * (`2026-08-30T10:12:00Z`, offset allowed). Croissant 1.1 accepts any
 * string for `startedAtTime` / `endedAtTime`; the profile requires the
 * value to parse (P2). Written as flat regexes (no nested quantifiers)
 * so the check is linear in the input length.
 */
const DATE_FORM = /^\d{4}-\d{2}-\d{2}$/;
const TIME_FORMS: ReadonlyArray<RegExp> = [
  /^\d{2}:\d{2}$/,
  /^\d{2}:\d{2}:\d{2}$/,
  /^\d{2}:\d{2}:\d{2}\.\d{1,9}$/,
];
const OFFSET_FORM = /^[+-]\d{2}:\d{2}$/;

export function isIso8601(value: string): boolean {
  const t = value.indexOf('T');
  const date = t === -1 ? value : value.slice(0, t);
  if (!DATE_FORM.test(date)) return false;
  if (t !== -1) {
    let time = value.slice(t + 1);
    if (time.endsWith('Z')) time = time.slice(0, -1);
    else if (time.length > 6 && OFFSET_FORM.test(time.slice(-6))) time = time.slice(0, -6);
    if (!TIME_FORMS.some((re) => re.test(time))) return false;
  }
  return !Number.isNaN(Date.parse(value));
}

export const IsoDateTime = z.string().refine(isIso8601, 'expected an ISO 8601 date or date-time');

/** Opt-in marker. The validator runs the layer only when it is present. */
export const ProvenanceProfileMarker = z.object({
  provenanceProfile: z.literal(PROVENANCE_PROFILE_VERSION),
});

// ---------------------------------------------------------------------------
// H1 — bio:sourceSite
// ---------------------------------------------------------------------------

export const SourceSiteSchema = z
  .object({
    name: NonEmptyString,
    /** ISO 3166-1 alpha-2. MUST be present on each site (section 5, H1). */
    country: CountryCode,
    '@id': z.string().optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// H3 — bio:deviceClass (an sc:DefinedTerm: DICOM modality code, GMDN term)
// ---------------------------------------------------------------------------

export const DeviceClassSchema = z
  .object({
    '@type': z.union([z.literal('sc:DefinedTerm'), z.literal('DefinedTerm')]).optional(),
    '@id': z.string().optional(),
    name: z.string().optional(),
    termCode: z.string().optional(),
    inDefinedTermSet: z.string().optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// H4 — bio:deidentification
// ---------------------------------------------------------------------------

export const DeidentificationMethod = z.enum([
  'SAFE_HARBOR',
  'EXPERT_DETERMINATION',
  'PSEUDONYMISATION',
  'SYNTHETIC',
  'NONE',
]);
export type DeidentificationMethod = z.infer<typeof DeidentificationMethod>;

/** Mirrors `bio:anonymizationLevel` (BIOCroissant v0.1). */
export const ResultingLevel = z.enum(['IDENTIFIED', 'LIMITED', 'DEIDENTIFIED', 'ANONYMIZED']);
export type ResultingLevel = z.infer<typeof ResultingLevel>;

export const DeidentificationSchema = z
  .object({
    '@type': z.union([z.literal('prov:Activity'), z.literal('Activity')]).optional(),
    method: DeidentificationMethod,
    resultingLevel: ResultingLevel,
    endedAtTime: IsoDateTime.optional(),
    wasAssociatedWith: z.unknown().optional(),
    notes: z.string().optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// H6 — bio:labelProtocol
// ---------------------------------------------------------------------------

export const LabelProtocolSchema = z
  .object({
    /** `version`, `labelScale` and `gradersPerItem` are the minimum. */
    version: NonEmptyString,
    labelScale: NonEmptyString,
    /** A single-grader reference is stated as `1`; undocumented is what fails. */
    gradersPerItem: z.number().int().min(1),
    graderQualification: z.string().optional(),
    adjudication: z.string().optional(),
    interRaterAgreement: z
      .object({ metric: z.string(), value: z.number() })
      .passthrough()
      .optional(),
    perRaterLabelsRetained: z.boolean().optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// A2 / A3 — bio:integrity and bio:receipts on a write-back distribution
// ---------------------------------------------------------------------------

export const IntegritySchema = z
  .object({
    /** Hash algorithm of the campaign's audit chain, e.g. `sha256`. */
    chain: NonEmptyString,
    /** Hex of the last `recordHash` in the chain (the chain head). */
    root: z.string().regex(/^[0-9a-fA-F]+$/, 'expected a hex digest'),
    /** Count of chained records. */
    events: z.number().int().min(0),
    verifiedAt: IsoDateTime.optional(),
  })
  .passthrough();

export const ReceiptKind = z.enum(['ACCESS', 'ANNOTATOR_AGREEMENT', 'CONSENT']);
export type ReceiptKind = z.infer<typeof ReceiptKind>;

export const ReceiptSchema = z
  .object({
    kind: ReceiptKind,
    /** Receipt contents are never inlined; the reference is what travels. */
    ref: NonEmptyString,
    issuedAt: IsoDateTime,
  })
  .passthrough();

/** Marker value the annotation-campaign edge keys on (section 6, A1). */
export const ANNOTATION_CAMPAIGN_ACTIVITY_KIND = 'ANNOTATION_CAMPAIGN' as const;

/**
 * The profile terms a campaign write-back distribution carries in
 * addition to its Croissant 1.0 `cr:FileObject` / `cr:FileSet` shape.
 */
export const WriteBackDistributionSchema = Croissant11DeltasSchema.pick({
  wasDerivedFrom: true,
  wasGeneratedBy: true,
})
  .extend({
    integrity: IntegritySchema.optional(),
    receipts: z.array(ReceiptSchema).optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Dataset-level profile
// ---------------------------------------------------------------------------

/**
 * The dataset-level shape of a `bio-prov/0.1` manifest. PROV-O properties
 * are the Croissant 1.1 shapes (picked, not duplicated); `bio:` terms are
 * the profile's own. Everything except the marker is optional here: which
 * of them a dataset MUST fill depends on its access tier and is decided by
 * `requirements.ts`.
 */
export const ProvenanceProfileSchema = Croissant11DeltasSchema.pick({
  wasDerivedFrom: true,
  wasGeneratedBy: true,
  wasAttributedTo: true,
})
  .extend({
    provenanceProfile: z.literal(PROVENANCE_PROFILE_VERSION),
    sourceSite: z.array(SourceSiteSchema).optional(),
    deviceClass: z.union([DeviceClassSchema, z.array(DeviceClassSchema)]).optional(),
    deidentification: DeidentificationSchema.optional(),
    labelProtocol: LabelProtocolSchema.optional(),
  })
  .passthrough();

export type ProvenanceProfile = z.infer<typeof ProvenanceProfileSchema>;
export type SourceSite = z.infer<typeof SourceSiteSchema>;
export type Deidentification = z.infer<typeof DeidentificationSchema>;
export type LabelProtocol = z.infer<typeof LabelProtocolSchema>;
export type Integrity = z.infer<typeof IntegritySchema>;
export type Receipt = z.infer<typeof ReceiptSchema>;

/** Normalized key the validator keys the layer on. */
export const PROVENANCE_PROFILE_PROPERTY = 'provenanceProfile' as const;
