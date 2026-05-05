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

    anonymizationLevel: AnonymizationLevel.optional(),

    /** clinicaltrials.gov identifier, format `NCT\d{8}`. */
    clinicalTrialId: z
      .string()
      .regex(/^NCT\d{8}$/, 'Expected NCT followed by 8 digits')
      .optional(),

    /**
     * Regulatory classification, free-form. Examples:
     *   "FDA-CDRH 510(k)", "EU-MDR Class IIa", "EU-IVDR Annex VIII".
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
  'anonymizationLevel',
  'clinicalTrialId',
  'regulatoryClass',
] as const;
