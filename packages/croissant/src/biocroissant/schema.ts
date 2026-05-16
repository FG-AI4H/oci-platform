import { z } from 'zod';

/**
 * BIOCroissant v0.1 — health extension to Croissant 1.1.
 *
 * This schema is OUR DRAFT. The GI-AI4H WG-Data hasn't published a
 * canonical BIOCroissant specification yet (as of 2026-05-05); the
 * properties below are the OCI Platform proposal, derived from the use
 * cases the WG-Data working group has discussed publicly (FAIR + DUO +
 * IRB attestations + imaging modality + de-identification level).
 *
 * Provisional namespace IRI: `https://oci.ai4h.net/biocroissant/v0.1#`
 * — owned by the platform, will 301-redirect to the WG-Data canonical
 * IRI once assigned. Existing manifests stay valid: we transparently
 * accept both during the transition.
 *
 * Open vocabularies on purpose: imaging modality and disease use
 * **RadLex** (open licence) and **ICD-11** (open licence) by default
 * rather than SNOMED CT (UMLS-restricted). Validators check the IRI
 * shape, not the term — semantic validation is a Phase B follow-up
 * once a vocabulary service is wired in.
 *
 * All properties are OPTIONAL at this layer. The validator's
 * `requireBioCroissant` mode (Phase B) will tighten which combinations
 * are required based on the dataset modality and `anonymizationLevel`.
 *
 * Encoded against the normalised form (prefixes stripped). Pre-norm
 * inputs use `bio:imagingModality`, etc.
 */

const Url = z.string().min(1);

const DefinedTermRef = z
  .object({
    '@type': z.union([z.literal('sc:DefinedTerm'), z.literal('DefinedTerm')]).optional(),
    '@id': z.string().optional(),
    name: z.string().optional(),
    termCode: z.string().optional(),
    inDefinedTermSet: Url.optional(),
  })
  .passthrough();

const PopulationCharacteristics = z
  .object({
    ageRange: z
      .object({
        min: z.number().optional(),
        max: z.number().optional(),
        unit: z.string().optional(), // "years", "months", "days"
      })
      .passthrough()
      .optional(),
    sexDistribution: z
      .object({
        female: z.number().optional(),
        male: z.number().optional(),
        intersexOrOther: z.number().optional(),
        unknown: z.number().optional(),
      })
      .passthrough()
      .optional(),
    /** Free-form for now; v1 will adopt a controlled vocabulary. */
    ethnicityDistribution: z.record(z.string(), z.number()).optional(),
    /** ISO 3166-1 alpha-2 country codes. */
    geographicOrigin: z.union([z.string().length(2), z.array(z.string().length(2))]).optional(),
  })
  .passthrough();

const AcquisitionEquipment = z
  .object({
    manufacturer: z.string().optional(),
    model: z.string().optional(),
    softwareVersion: z.string().optional(),
  })
  .passthrough();

const IrbApproval = z
  .object({
    approvingBody: z.string(),
    approvalNumber: z.string(),
    approvalDate: z.string(), // ISO 8601 date
    approvalDocument: Url.optional(),
    expiryDate: z.string().optional(),
  })
  .passthrough();

/**
 * HIPAA-aligned 4-level scale.
 *   IDENTIFIED   — direct identifiers present (PHI/PII).
 *   LIMITED      — limited dataset (HIPAA §164.514(e)) — direct identifiers
 *                  removed but dates / zip3 / city allowed; requires DUA.
 *   DEIDENTIFIED — Safe Harbor (§164.514(b)(2)) or Expert Determination
 *                  (§164.514(b)(1)).
 *   ANONYMIZED   — irreversibly anonymised; not subject to HIPAA at all.
 *
 * For EU/GDPR-aligned consumers: `DEIDENTIFIED` ≈ pseudonymised,
 * `ANONYMIZED` ≈ anonymised. Phase B will add `gdprCategory` if needed.
 */
const AnonymizationLevel = z.enum(['IDENTIFIED', 'LIMITED', 'DEIDENTIFIED', 'ANONYMIZED']);

/**
 * Consent legal basis under which the dataset was collected. WHO/ITU
 * FG-AI4H (2023) §5.5 and WHO 2021 ch. 8 cite this as a non-negotiable
 * provenance field; EHDS Art. 33-34 (secondary use) bind against it.
 *
 *   EXPLICIT_INFORMED      — written informed consent for research / AI use
 *   OPT_OUT                — implied consent under a published opt-out programme
 *   RETROSPECTIVE_WAIVER   — IRB waiver of consent for retrospective study
 *   ARCHIVAL_EXCEPTION     — archival data covered by legal/heritage exception
 *   PUBLIC_INTEREST        — GDPR Art. 9(2)(i) public-health public-interest basis
 *   ANONYMOUS_NO_CONSENT   — fully anonymous data not subject to consent law
 */
const ConsentBasis = z.enum([
  'EXPLICIT_INFORMED',
  'OPT_OUT',
  'RETROSPECTIVE_WAIVER',
  'ARCHIVAL_EXCEPTION',
  'PUBLIC_INTEREST',
  'ANONYMOUS_NO_CONSENT',
]);

/**
 * GDPR / equivalent lawful-basis cell per jurisdiction. Captures both
 * the Art. 6 (general) and Art. 9 (sensitive-data) cells the data
 * processing relies on. Free-text article codes ("Art.6(1)(e)",
 * "Art.9(2)(j)") so non-GDPR regimes (HIPAA §164.512(i), Singapore PDPA,
 * etc.) can be expressed in the same shape.
 */
const LawfulBasis = z
  .object({
    /** ISO 3166-1 alpha-2. */
    jurisdiction: z.string().regex(/^[A-Z]{2}$/, 'expected ISO 3166-1 alpha-2'),
    /** Free-text framework name, e.g. "GDPR", "HIPAA", "Swiss-FADP". */
    framework: z.string().min(1).max(50).optional(),
    /** Article / clause reference, e.g. "Art.6(1)(e)" + "Art.9(2)(j)". */
    articleRefs: z.array(z.string().max(50)).min(1).max(10),
    /** Optional narrative — DPO's note, ethics-board rationale. */
    notes: z.string().max(2000).optional(),
  })
  .passthrough();

/**
 * GDPR controller / processor declarations (Art. 4(7)+(8)). Lifted to
 * dataset granularity because OCI datasets cross controller boundaries
 * routinely (host institution = controller, OCI Platform = processor),
 * and the DPIA (WHO/ITU FG-AI4H 2023 §5.5.2) reads from these fields.
 */
const DataParty = z
  .object({
    name: z.string().min(1).max(200),
    /** ISO 3166-1 alpha-2 country where the legal entity is registered. */
    jurisdictionCountry: z.string().regex(/^[A-Z]{2}$/),
    /** Contact email — DPO's mailbox or institutional point of contact. */
    contactEmail: z.string().email().optional(),
  })
  .passthrough();


export const BioCroissantSchema = z
  .object({
    /**
     * Imaging modality — RadLex CID or canonical IRI.
     * Examples: `RID10312` (Computed Tomography), `RID10357` (X-ray Radiograph).
     */
    imagingModality: z.union([DefinedTermRef, z.array(DefinedTermRef)]).optional(),
    /**
     * Body region — RadLex / FMA CID or IRI.
     */
    bodyRegion: z.union([DefinedTermRef, z.array(DefinedTermRef)]).optional(),
    /**
     * Disease / condition — ICD-11 codes preferred (open licence).
     * Multi-valued: a chest CT for COVID-19 study + comorbidities.
     */
    diseaseCondition: z.union([DefinedTermRef, z.array(DefinedTermRef)]).optional(),

    populationCharacteristics: PopulationCharacteristics.optional(),

    /**
     * Free-text protocol description (DICOM acquisition params or similar).
     */
    dataAcquisitionProtocol: z.string().optional(),
    dataAcquisitionEquipment: z
      .union([AcquisitionEquipment, z.array(AcquisitionEquipment)])
      .optional(),

    /** Required for any human-derived dataset to publish at PUBLIC visibility. */
    irbApproval: IrbApproval.optional(),

    /**
     * Consent scope — leverages Croissant 1.1's `consentCode` (DUO terms),
     * carried at the dataset level via `cr:` extensions. We do NOT
     * re-encode DUO here; if you need richer machine-actionable consent
     * use Croissant 1.1's `consentCode` array directly.
     */
    consentNotes: z.string().optional(),

    /**
     * Consent legal basis under which the dataset was collected
     * (ADR-0013, WHO/ITU FG-AI4H 2023 §5.5). Distinct from
     * `consentNotes` (free text) and from DUO terms (downstream-use
     * encoding): this field declares *how* the upstream consent was
     * obtained at collection time.
     */
    consentBasis: ConsentBasis.optional(),

    anonymizationLevel: AnonymizationLevel.optional(),

    /**
     * Per-jurisdiction GDPR / equivalent lawful-basis declarations
     * (WHO/ITU FG-AI4H 2023 §5.5.1; EU AI Act + EHDS overlap). One
     * entry per legal regime that gates the processing. Empty array is
     * acceptable for fully anonymous data outside the scope of any
     * data-protection regime.
     */
    lawfulBasis: z.array(LawfulBasis).max(20).optional(),

    /**
     * EHDS (Regulation 2025/327) secondary-use data permit identifier.
     * Required from March 2029 for cross-EU secondary use; populated
     * earlier on a voluntary basis. Free-text format until EHDS DAB
     * issuance schemes stabilise.
     */
    ehdsDataPermitId: z.string().max(200).optional(),

    /**
     * Whether redistribution / processing in jurisdictions other than
     * the source jurisdiction is permitted. When `true`,
     * `jurisdictionsEligible` lists the authorised set; an empty list
     * with `crossBorderSharingPermitted=true` means "any jurisdiction"
     * (rare; OCI surfaces a warning to the host before publish).
     */
    crossBorderSharingPermitted: z.boolean().optional(),
    jurisdictionsEligible: z.array(z.string().regex(/^[A-Z]{2}$/)).max(250).optional(),

    /**
     * GDPR Art. 4(7) data controller. Independent of any platform-
     * processor role: OCI is typically the processor, the host
     * institution the controller.
     */
    dataController: DataParty.optional(),
    /** GDPR Art. 4(8) data processor; absent if controller == processor. */
    dataProcessor: DataParty.optional(),

    /**
     * Free-text statement of how the dataset's `populationCharacteristics`
     * relate to a target population the dataset is suited to support.
     * WHO 2021 ch. 4 stresses "missing demographics + why" — this field
     * carries that narrative so a regulator reading the manifest can
     * understand the gap between the dataset's actual composition and
     * any deployment population a consumer might apply it to.
     */
    representativenessStatement: z.string().max(4000).optional(),

    /** clinicaltrials.gov identifier, format `NCT\d{8}`. */
    clinicalTrialId: z
      .string()
      .regex(/^NCT\d{8}$/, 'Expected NCT followed by 8 digits')
      .optional(),

    /**
     * Regulatory classification, free-form. Examples:
     *   "FDA-CDRH 510(k)", "EU-MDR Class IIa", "EU-IVDR Annex VIII".
     * Phase B may tighten this to a typed pathway enum mirroring
     * `@oci/shared-types` `RegulatoryPathwaySchema`.
     */
    regulatoryClass: z.string().optional(),
  })
  .passthrough();

export type BioCroissant = z.infer<typeof BioCroissantSchema>;

/** Heuristic: any of these properties present → manifest uses BIOCroissant. */
export const BIOCROISSANT_PROPERTIES = [
  'imagingModality',
  'bodyRegion',
  'diseaseCondition',
  'populationCharacteristics',
  'dataAcquisitionProtocol',
  'dataAcquisitionEquipment',
  'irbApproval',
  'consentNotes',
  'consentBasis',
  'anonymizationLevel',
  'lawfulBasis',
  'ehdsDataPermitId',
  'crossBorderSharingPermitted',
  'jurisdictionsEligible',
  'dataController',
  'dataProcessor',
  'representativenessStatement',
  'clinicalTrialId',
  'regulatoryClass',
] as const;
