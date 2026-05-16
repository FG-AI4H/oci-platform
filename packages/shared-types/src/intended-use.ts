/**
 * Intended-Use Statement (IUS) — schema + IMDRF risk-tier auto-derivation.
 *
 * Locked by ADR-0013. The IUS captures "what is this dataset / model
 * *medically for*" — distinct from the requester-side
 * `IntendedUseCategorySchema` (in `./index.ts`), which describes what
 * the *requester* intends to do with the data. Different concept, same
 * word — see ADR-0013 §"Alternatives considered".
 *
 * Two carriers in the platform:
 *   1. Datasets — required at DRAFT → REVIEW transition. Mirrored into
 *      the BIOCroissant manifest under `bio:intendedUse` for external
 *      consumers; persisted on `Dataset.intendedUse Json?`.
 *   2. Models  — required at submission to the future `evaluation`
 *      module (Phase B). Persisted on `ModelCard.intendedUse`.
 *
 * The schema lives here (not in `@oci/croissant`) so the API + Web
 * forms can validate without pulling in the croissant package. The
 * BIOCroissant schema *imports* from this module.
 */

import { z } from 'zod';

/**
 * IMDRF risk-tier vocabulary (significance × healthcare-situation
 * severity, per IMDRF SaMD WG/N12 Final 2014 Tables 5/6, condensed to
 * the 4-tier shape OCI uses operationally).
 *
 *   I   — informational / non-serious / low impact
 *   II  — drives clinician action; non-critical
 *   III — drives clinician action; serious/critical clinical context
 *   IV  — autonomous or near-autonomous decision in serious context
 */
export const RiskTierSchema = z.enum(['I', 'II', 'III', 'IV']);
export type RiskTier = z.infer<typeof RiskTierSchema>;

/**
 * Numeric rank for ordered comparisons (e.g. "is this tier ≥ III").
 */
export const RISK_TIER_RANK: Readonly<Record<RiskTier, number>> = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
};

export const MedicalPurposeSchema = z.enum([
  'screening',
  'diagnosis',
  'triage',
  'treatment-planning',
  'monitoring',
  'prognosis',
  'clinical-decision-support',
  'administrative',
  'patient-education',
  'research-only',
  'other',
]);
export type MedicalPurpose = z.infer<typeof MedicalPurposeSchema>;

export const ClinicalPathwaySchema = z.enum([
  'standalone',
  'adjunct-with-confirmation',
  'triage-before-clinician',
  'screening-before-specialist',
  'research-only',
]);
export type ClinicalPathway = z.infer<typeof ClinicalPathwaySchema>;

export const OperatingEnvironmentSchema = z.enum([
  'primary-care',
  'hospital-inpatient',
  'hospital-outpatient',
  'emergency',
  'field-or-community',
  'home-or-telehealth',
  'lab',
  'research',
]);
export type OperatingEnvironment = z.infer<typeof OperatingEnvironmentSchema>;

export const IntendedUserRoleSchema = z.enum([
  'nurse',
  'general-clinician',
  'specialist',
  'radiologist',
  'pathologist',
  'lab-tech',
  'patient',
  'researcher',
  'administrator',
  'other',
]);
export type IntendedUserRole = z.infer<typeof IntendedUserRoleSchema>;

/**
 * Target-population descriptor. Demographic / clinical eligibility for
 * the device's intended use. Loose by design — the population the
 * dataset *contains* lives in `populationCharacteristics` (BIOCroissant);
 * the population the device is *for* lives here, and the two are
 * compared via `representativenessStatement`.
 */
export const TargetPopulationSchema = z
  .object({
    ageRangeYears: z
      .object({
        min: z.number().min(0).max(150).optional(),
        max: z.number().min(0).max(150).optional(),
      })
      .optional(),
    sexEligibility: z.enum(['any', 'female-only', 'male-only', 'other-specified']).optional(),
    /** Free-text clinical strata; bound to vocabulary in Phase B. */
    clinicalStrata: z.array(z.string().min(1).max(200)).max(50).optional(),
    populationDescription: z.string().max(2000).optional(),
  })
  .strict();
export type TargetPopulation = z.infer<typeof TargetPopulationSchema>;

/**
 * Intended-Use Statement. Schema-versioned via `v` so future field
 * additions don't break manifests in the wild (same pattern as
 * `AccessRequestAttestationsSchema`).
 */
export const IntendedUseStatementSchema = z
  .object({
    v: z.literal(1).default(1),
    medicalPurpose: MedicalPurposeSchema,
    medicalPurposeOther: z.string().min(1).max(200).optional(),
    bodySystemOrSite: z.string().min(1).max(200).optional(),
    targetPopulation: TargetPopulationSchema.optional(),
    intendedUserRole: z.array(IntendedUserRoleSchema).max(8).optional(),
    operatingEnvironment: z.array(OperatingEnvironmentSchema).max(8).optional(),
    intendedClinicalPathway: ClinicalPathwaySchema.optional(),
    operatingPrinciple: z.string().max(1000).optional(),
    foreseeableMisuse: z.string().min(1).max(4000),
    contraindications: z.string().max(4000),
    riskTier: RiskTierSchema,
    /** Required when `riskTier` was overridden upward of the auto-derived value by ≥ 2 tiers. */
    riskTierJustification: z.string().max(4000).optional(),
  })
  .strict()
  .refine(
    (ius) => ius.medicalPurpose !== 'other' || (ius.medicalPurposeOther?.length ?? 0) > 0,
    {
      message: 'medicalPurposeOther is required when medicalPurpose is "other"',
      path: ['medicalPurposeOther'],
    },
  );
export type IntendedUseStatement = z.infer<typeof IntendedUseStatementSchema>;

/**
 * Pure auto-derivation of the IMDRF risk tier from the IUS shape.
 * Encodes the IMDRF SaMD WG/N12 Final 2014 Table 5/6 matrix in the
 * condensed form OCI uses (ADR-0013 §3).
 *
 * The submitter can override the auto-derived tier; an upward override
 * by ≥ 2 tiers requires `riskTierJustification` (enforced at the
 * service boundary, not in the pure derivation).
 *
 * Pure: no I/O, no DB, no clock. Runs on both API and web form.
 */
export function deriveRiskTier(
  partial: Pick<
    IntendedUseStatement,
    'medicalPurpose' | 'intendedClinicalPathway' | 'operatingEnvironment'
  >,
): RiskTier {
  const { medicalPurpose, intendedClinicalPathway, operatingEnvironment } = partial;

  // Research-only and administrative work — lowest tier regardless of pathway.
  if (medicalPurpose === 'research-only') return 'I';
  if (medicalPurpose === 'administrative') return 'I';
  if (medicalPurpose === 'patient-education') return 'I';

  // Critical-pathway clinical decisions
  if (
    medicalPurpose === 'diagnosis' ||
    medicalPurpose === 'treatment-planning'
  ) {
    if (intendedClinicalPathway === 'standalone') return 'IV';
    if (intendedClinicalPathway === 'adjunct-with-confirmation') return 'III';
    return 'III';
  }

  // Triage and screening — bump up in emergency settings
  if (medicalPurpose === 'triage' || medicalPurpose === 'screening') {
    const inEmergency = operatingEnvironment?.includes('emergency') ?? false;
    if (inEmergency) return 'III';
    if (
      intendedClinicalPathway === 'triage-before-clinician' ||
      intendedClinicalPathway === 'screening-before-specialist'
    ) {
      return 'II';
    }
    return 'II';
  }

  // Prognosis / monitoring — typically II, IV only when standalone
  if (medicalPurpose === 'prognosis' || medicalPurpose === 'monitoring') {
    if (intendedClinicalPathway === 'standalone') return 'III';
    return 'II';
  }

  // CDS — adjunct-with-confirmation is the typical case
  if (medicalPurpose === 'clinical-decision-support') return 'II';

  // `other` — conservative default. Submitter is expected to override + justify.
  return 'II';
}

/**
 * Whether an upward override (declared vs. auto-derived) is "large
 * enough" to require `riskTierJustification`. ADR-0013 §2: ≥ 2 tiers
 * up requires justification; ≤ 1 tier or any downward move is free.
 */
export function overrideRequiresJustification(
  autoDerived: RiskTier,
  declared: RiskTier,
): boolean {
  // eslint-disable-next-line security/detect-object-injection -- typed RiskTier keys, total over `RISK_TIER_RANK`
  const delta = RISK_TIER_RANK[declared] - RISK_TIER_RANK[autoDerived];
  return delta >= 2;
}
