import type { ModelClass, RegulatoryApproval } from '@oci/shared-types';

/**
 * Display labels for the public model catalogue (#591). Shared by the list
 * and detail pages so a value reads the same everywhere it appears.
 */

export const MODEL_CLASS_OPTIONS: ReadonlyArray<{ value: ModelClass; label: string }> = [
  { value: 'classical', label: 'Classical ML' },
  { value: 'time-series', label: 'Time series' },
  { value: 'foundation', label: 'Foundation model' },
  { value: 'lmm', label: 'Large multimodal model' },
  { value: 'agent', label: 'Agent' },
];

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
export const JURISDICTION_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'EU', label: 'European Union' },
  { value: 'CH', label: 'Switzerland' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'US', label: 'United States' },
];

export function normaliseJurisdiction(value: string | undefined): string | null {
  const v = value?.trim().toUpperCase();
  return v && /^[A-Z0-9-]{2,64}$/.test(v) ? v : null;
}

/** `clinical-decision-support` → `Clinical decision support`. */
export function humanise(value: string): string {
  const spaced = value.replace(/-/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export const REGULATORY_STATUS_LABEL: Record<RegulatoryApproval['status'], string> = {
  none: 'No regulatory approval',
  pending: 'Approval pending',
  granted: 'Approval granted',
  withdrawn: 'Approval withdrawn',
};

export const REGULATORY_STATUS_TONE: Record<
  RegulatoryApproval['status'],
  'neutral' | 'info' | 'success' | 'warning'
> = {
  none: 'neutral',
  pending: 'info',
  granted: 'success',
  withdrawn: 'warning',
};
