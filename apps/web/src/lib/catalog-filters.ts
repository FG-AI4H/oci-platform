import { AnonymizationLevelSchema, type AnonymizationLevel } from '@oci/shared-types';

/**
 * Facet options for the anonymisation level, in ascending order of
 * protection. Labels keep the familiar word "pseudonymised" next to the
 * BIOCroissant spelling so a reader used to the old facet still finds it
 * (#509).
 */
export const ANONYMIZATION_OPTIONS: ReadonlyArray<{ value: AnonymizationLevel; label: string }> = [
  { value: 'IDENTIFIED', label: 'Identified' },
  { value: 'LIMITED', label: 'Limited dataset' },
  { value: 'DEIDENTIFIED', label: 'De-identified (pseudonymised)' },
  { value: 'ANONYMIZED', label: 'Anonymised' },
];

/**
 * Coerce a URL search-param to a known anonymisation level, or `null`.
 * Unknown values — including `PSEUDONYMIZED` from a bookmark made before
 * the scale changed — drop the filter instead of reaching the API, which
 * would answer 400.
 */
export function normaliseAnonymizationLevel(
  value: string | string[] | undefined,
): AnonymizationLevel | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate) return null;
  const parsed = AnonymizationLevelSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/** Human label for a level, falling back to the raw value. */
export function anonymizationLabel(value: string): string {
  return ANONYMIZATION_OPTIONS.find((o) => o.value === value)?.label ?? value;
}
