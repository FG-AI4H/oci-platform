import type {
  ClinicalPathway,
  IntendedUserRole,
  MedicalPurpose,
  ModelClass,
  OperatingEnvironment,
  RegulatoryApproval,
} from '@oci/shared-types';

/**
 * Display labels for the public model catalogue (#591). Shared by the list
 * and detail pages so a value reads the same everywhere it appears.
 *
 * Two kinds of label live here. The English ones (`modelClassLabel`,
 * `humanise`) feed the machine-readable JSON-LD (`model-jsonld.ts`), which
 * stays in English whatever the interface language. The `*Text` helpers
 * take the page's `t` for the `Models` namespace and return the label in
 * the interface language (#654), falling back to the English rendering for
 * a value the catalogue does not know.
 */

export const MODEL_CLASS_OPTIONS: ReadonlyArray<{ value: ModelClass; label: string }> = [
  { value: 'classical', label: 'Classical ML' },
  { value: 'time-series', label: 'Time series' },
  { value: 'foundation', label: 'Foundation model' },
  { value: 'lmm', label: 'Large multimodal model' },
  { value: 'agent', label: 'Agent' },
];

/** English model-class label, for the JSON-LD. Pages use `modelClassText`. */
export function modelClassLabel(value: string): string {
  return MODEL_CLASS_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

export function normaliseModelClass(value: string | undefined): ModelClass | null {
  return MODEL_CLASS_OPTIONS.find((o) => o.value === value)?.value ?? null;
}

/**
 * Curated jurisdiction shortlist for the filter rail. The API matches any
 * code case-insensitively, so a `?jurisdiction=` outside this list still
 * works from a hand-typed URL.
 */
export const JURISDICTION_OPTIONS = ['EU', 'CH', 'GB', 'US'] as const;
export type JurisdictionOption = (typeof JURISDICTION_OPTIONS)[number];

export function normaliseJurisdiction(value: string | undefined): string | null {
  const v = value?.trim().toUpperCase();
  return v && /^[A-Z0-9-]{2,64}$/.test(v) ? v : null;
}

/** `clinical-decision-support` → `Clinical decision support`. */
export function humanise(value: string): string {
  const spaced = value.replace(/-/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export const REGULATORY_STATUS_TONE: Record<
  RegulatoryApproval['status'],
  'neutral' | 'info' | 'success' | 'warning'
> = {
  none: 'neutral',
  pending: 'info',
  granted: 'success',
  withdrawn: 'warning',
};

// ---------------------------------------------------------------------------
// Translated labels (#654)
// ---------------------------------------------------------------------------

/** The `Models` message keys an enum value maps to. */
export type ModelLabelKey =
  | `modelClass.${ModelClass}`
  | `medicalPurpose.${MedicalPurpose}`
  | `clinicalPathway.${ClinicalPathway}`
  | `operatingEnvironment.${OperatingEnvironment}`
  | `intendedUser.${IntendedUserRole}`
  | `regulatoryStatus.${RegulatoryApproval['status']}`
  | `jurisdiction.${JurisdictionOption}`;

/** The page's `t` for the `Models` namespace, narrowed to the enum keys. */
export type ModelLabelTranslator = (key: ModelLabelKey) => string;

const MEDICAL_PURPOSES: ReadonlySet<string> = new Set<MedicalPurpose>([
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

const CLINICAL_PATHWAYS: ReadonlySet<string> = new Set<ClinicalPathway>([
  'standalone',
  'adjunct-with-confirmation',
  'triage-before-clinician',
  'screening-before-specialist',
  'research-only',
]);

const OPERATING_ENVIRONMENTS: ReadonlySet<string> = new Set<OperatingEnvironment>([
  'primary-care',
  'hospital-inpatient',
  'hospital-outpatient',
  'emergency',
  'field-or-community',
  'home-or-telehealth',
  'lab',
  'research',
]);

const INTENDED_USERS: ReadonlySet<string> = new Set<IntendedUserRole>([
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

export function modelClassText(t: ModelLabelTranslator, value: string): string {
  const known = normaliseModelClass(value);
  return known ? t(`modelClass.${known}`) : value;
}

export function medicalPurposeText(t: ModelLabelTranslator, value: string): string {
  return MEDICAL_PURPOSES.has(value)
    ? t(`medicalPurpose.${value as MedicalPurpose}`)
    : humanise(value);
}

export function clinicalPathwayText(t: ModelLabelTranslator, value: string): string {
  return CLINICAL_PATHWAYS.has(value)
    ? t(`clinicalPathway.${value as ClinicalPathway}`)
    : humanise(value);
}

export function operatingEnvironmentText(t: ModelLabelTranslator, value: string): string {
  return OPERATING_ENVIRONMENTS.has(value)
    ? t(`operatingEnvironment.${value as OperatingEnvironment}`)
    : humanise(value);
}

export function intendedUserText(t: ModelLabelTranslator, value: string): string {
  return INTENDED_USERS.has(value)
    ? t(`intendedUser.${value as IntendedUserRole}`)
    : humanise(value);
}

export function regulatoryStatusText(
  t: ModelLabelTranslator,
  status: RegulatoryApproval['status'],
): string {
  return t(`regulatoryStatus.${status}`);
}

export function jurisdictionText(t: ModelLabelTranslator, value: JurisdictionOption): string {
  return t(`jurisdiction.${value}`);
}
