import type { MetadataVisibilityBucket } from '@oci/shared-types';

/**
 * OCI-platform default metadata-visibility table (ADR-0010 Decision 1,
 * source-of-truth priority 3). Keyed by the lower-cased metadata field
 * name; applies when neither a campaign-manager override (priority 1)
 * nor a dataset Croissant `oci:annotationVisibility` tag (priority 2)
 * is set.
 *
 * ADR-0010 drives the seed entries:
 *   required — needed to interpret the sample at all
 *   optional — useful for some tasks, biasing for others
 *   hidden   — biasing or irrelevant; manager may promote with rationale
 *   never    — PHI / direct identifiers (server-side filtered, hard floor)
 *
 * Unknown fields fall through to `hidden` (the ADR's default-hide
 * stance — see `defaultBucketForField`). The table is intentionally
 * small; it grows as the catalog field vocabulary stabilises (#214 /
 * #223). The annotation API is the SECOND enforcement layer for the
 * `never` bucket — the catalog data-governance layer (ADR-0003) is the
 * first; this is defence-in-depth, not the sole guard.
 */
export const OCI_DEFAULT_VISIBILITY_TABLE: Record<string, MetadataVisibilityBucket> = {
  // required — interpretation-relevant
  modality: 'required',
  body_part: 'required',
  bodypart: 'required',
  view: 'required',
  view_orientation: 'required',
  orientation: 'required',
  slice_index: 'required',
  acquisition_parameters: 'required',
  clinical_question: 'required',
  // optional — task-dependent; hidden by default, shown gate 2+
  age_bin: 'optional',
  sex: 'optional',
  site_id: 'optional',
  hospital_site: 'optional',
  // hidden — priming / fairness risk; manager may promote per gate
  prior_diagnosis: 'hidden',
  prior_diagnoses: 'hidden',
  radiologist_report: 'hidden',
  original_report: 'hidden',
  peer_labels: 'hidden',
  scanner_make: 'hidden',
  scanner_model: 'hidden',
  ethnicity: 'hidden',
  race: 'hidden',
  hospital_id: 'hidden',
  // never — direct identifiers (HIPAA Safe-Harbor); server-side filtered
  patient_name: 'never',
  patient_id: 'never',
  mrn: 'never',
  medical_record_number: 'never',
  dob: 'never',
  date_of_birth: 'never',
  ssn: 'never',
  accession_number: 'never',
  phone: 'never',
  email: 'never',
  address: 'never',
};

/**
 * Direct-identifier name patterns (HIPAA Safe-Harbor) that resolve to
 * `never` even when the field isn't explicitly in the table. Keeps a
 * typo'd / vendor-specific identifier field (e.g. `patientFullName`)
 * from leaking through the default-hide fallback. Conservative by
 * design — false positives here only over-blind, which is the safe
 * direction.
 */
const NEVER_FIELD_PATTERNS: readonly RegExp[] = [
  /name$/,
  /\bmrn\b/,
  /record_number/,
  /\bdob\b/,
  /date_of_birth/,
  /\bssn\b/,
  /social_security/,
  /patient_id/,
  /accession/,
  /phone/,
  /\bfax\b/,
  /email/,
  /address/,
  /\bzip\b/,
  /postal/,
  /\burl\b/,
  /ip_address/,
  /device_id/,
  /serial_number/,
  /biometric/,
  /photo/,
  /\bface\b/,
];

/**
 * Resolve the OCI default bucket for a field, or `undefined` when the
 * field is unknown to the table (the caller then applies the
 * `hidden` default-hide fallback). The `never` patterns win over an
 * (absent) exact entry so direct identifiers are caught even when not
 * explicitly tabled.
 */
export function defaultBucketForField(field: string): MetadataVisibilityBucket | undefined {
  const key = field.trim().toLowerCase();
  const exact = OCI_DEFAULT_VISIBILITY_TABLE[key];
  if (exact === 'never') return 'never';
  if (NEVER_FIELD_PATTERNS.some((re) => re.test(key))) return 'never';
  return exact;
}
