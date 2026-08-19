import { z } from 'zod';

/**
 * Regulatory pathway the AI-builder is targeting (#120). Open list to
 * cover non-US/EU pathways (national health-tech regulators emerging
 * in LMIC) — the matcher doesn't gate on the value, the host reviewer
 * eyeballs it. Free-text-with-suggested-vocabulary in the form.
 *
 * Extracted to its own module in #432 so the `ModelCard` regulatory-approval
 * block reuses this vocabulary instead of declaring a competing one — the
 * conform-don't-invent discipline of ADR-0002 / ADR-0019.
 */
export const RegulatoryPathwaySchema = z.enum([
  'FDA_510K',
  'FDA_DE_NOVO',
  'FDA_PMA',
  'EU_MDR_CLASS_I',
  'EU_MDR_CLASS_IIA',
  'EU_MDR_CLASS_IIB',
  'EU_MDR_CLASS_III',
  'EU_IVDR',
  'NATIONAL_LMIC',
  'NONE_RESEARCH_ONLY',
  'OTHER',
]);
export type RegulatoryPathway = z.infer<typeof RegulatoryPathwaySchema>;
