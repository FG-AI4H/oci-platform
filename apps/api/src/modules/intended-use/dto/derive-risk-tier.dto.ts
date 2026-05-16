import { z } from 'zod';
import {
  MedicalPurposeSchema,
  ClinicalPathwaySchema,
  OperatingEnvironmentSchema,
  RiskTierSchema,
} from '@oci/shared-types';

/**
 * Body for `POST /v2/intended-use/derive-risk-tier`. Regulator-facing
 * helper: callers send a partial IUS shape; the service returns the
 * auto-derived IMDRF tier (ADR-0013 §3 matrix) without persisting
 * anything. Pure read; no auth scope beyond an authenticated user.
 */
export const DeriveRiskTierRequestSchema = z
  .object({
    medicalPurpose: MedicalPurposeSchema,
    intendedClinicalPathway: ClinicalPathwaySchema.optional(),
    operatingEnvironment: z.array(OperatingEnvironmentSchema).max(8).optional(),
  })
  .strict();
export type DeriveRiskTierRequest = z.infer<typeof DeriveRiskTierRequestSchema>;

export const DeriveRiskTierResponseSchema = z
  .object({
    autoDerivedTier: RiskTierSchema,
    /** Free-text rationale string for the UI to render alongside the tier badge. */
    rationale: z.string(),
  })
  .strict();
export type DeriveRiskTierResponse = z.infer<typeof DeriveRiskTierResponseSchema>;
