/**
 * Dataset modality → allowed annotation campaign task kinds (#247).
 *
 * Curated mapping shared between the campaign-create form (web — for
 * disabling incompatible radios with a rationale tooltip) and the
 * `POST /v2/annotation/campaigns` server-side guard (api — defence in
 * depth). One file, one table, one source of truth.
 *
 * Modality values come from the BIOCroissant manifest's
 * `bio:imagingModality` (and similar) entries — see
 * `packages/croissant/src/biocroissant/schema.ts`. Authoring tools may
 * emit either a `DefinedTerm`'s `name` (free text such as `"X-ray"`)
 * or its `termCode` (e.g. `"X-ray"`, `"CT"`). The mapping uses the
 * human-readable names + a small alias table so common synonyms /
 * abbreviations resolve to the same canonical key.
 *
 * The starter set in the issue body matches what BIOCroissant authoring
 * surfaces today; new modalities are a one-line addition here. When a
 * dataset declares no recognised modalities the platform falls back to
 * "allow all task kinds" — the campaign manager is not blocked because
 * the catalogue lacks structured metadata; instead the API logs a
 * warning so hosts get nudged to publish modality metadata.
 *
 * The full per-task capability matrix (which tools support which
 * modality × task combinations) lands with #214 (ADR-0007). This file
 * is the cheap, manifest-driven first cut: modality → task-kind set.
 */

import type { CampaignTaskKind } from './index.js';

/**
 * Canonical modality keys recognised by the mapping. The order here
 * follows the issue body; adding a new modality is a one-line addition
 * plus an entry in `MODALITY_TASK_KIND_MAP`.
 *
 * `mixed` is the catch-all for datasets that combine modalities the
 * platform can't enumerate (e.g. imaging + EHR notes); we allow the
 * full task-kind set so the host's explicit declaration drives the
 * tool dropdown rather than this curated table.
 */
export type CanonicalModality =
  | 'X-ray'
  | 'CT'
  | 'MRI'
  | 'Ultrasound'
  | 'Fundus'
  | 'Pathology'
  | 'Text'
  | 'EHR'
  | 'Transcript'
  | 'Timeseries'
  | 'ECG'
  | 'EEG'
  | 'Mixed';

const ALL_TASK_KINDS: readonly CampaignTaskKind[] = [
  'CLASSIFICATION',
  'DETECTION',
  'SEGMENTATION',
  'LOCALIZATION',
  'MULTI_MODAL',
] as const;

/**
 * Curated modality → allowed task kinds. The set is intentionally
 * coarse: it stops campaign managers from pairing a text-only dataset
 * with a SEGMENTATION campaign, which is the operational guardrail the
 * issue calls for. Fine-grained tool capability (a given tool's
 * coverage of detection-on-X-ray vs detection-on-CT) lives elsewhere
 * (#214, ADR-0007).
 */
export const MODALITY_TASK_KIND_MAP: Readonly<
  Record<CanonicalModality, readonly CampaignTaskKind[]>
> = {
  // Imaging modalities — pixel-addressable; the full annotation
  // toolkit applies (image-level classification, bounding boxes,
  // pixel masks, point landmarks).
  'X-ray': ['CLASSIFICATION', 'DETECTION', 'SEGMENTATION', 'LOCALIZATION'],
  CT: ['CLASSIFICATION', 'DETECTION', 'SEGMENTATION', 'LOCALIZATION'],
  MRI: ['CLASSIFICATION', 'DETECTION', 'SEGMENTATION', 'LOCALIZATION'],
  Ultrasound: ['CLASSIFICATION', 'DETECTION', 'SEGMENTATION', 'LOCALIZATION'],
  Fundus: ['CLASSIFICATION', 'DETECTION', 'SEGMENTATION', 'LOCALIZATION'],
  Pathology: ['CLASSIFICATION', 'DETECTION', 'SEGMENTATION', 'LOCALIZATION'],

  // Non-imaging document-like modalities — only label-level tasks
  // make sense (spatial annotation is undefined on a free-text note).
  // MULTI_MODAL stays available so a downstream campaign can join the
  // text with an imaging dataset.
  Text: ['CLASSIFICATION', 'MULTI_MODAL'],
  EHR: ['CLASSIFICATION', 'MULTI_MODAL'],
  Transcript: ['CLASSIFICATION', 'MULTI_MODAL'],

  // Time-series — classification only. Detection on a 1-D signal could
  // be argued for (R-peak detection on ECG) but the platform's
  // detection task today is bounding-box-on-2D; widening that is
  // ADR-0007 territory.
  Timeseries: ['CLASSIFICATION'],
  ECG: ['CLASSIFICATION'],
  EEG: ['CLASSIFICATION'],

  // Catch-all for hybrid datasets. The host's explicit modality list
  // wasn't expressible above, so don't constrain the manager — the
  // server still enforces the tool's `supportedTaskKinds`.
  Mixed: ALL_TASK_KINDS,
};

/**
 * Alias table: case-insensitive synonyms / abbreviations / common
 * variant spellings → canonical key. Datasets in the wild use varied
 * conventions ("Chest X-ray" / "Radiograph" / "CXR" — all map to
 * `X-ray`). Anything not matched here falls through the
 * `allowedTaskKindsForModalities` fallback ("allow all + warn").
 *
 * Keys are lower-cased at lookup time; entries here can be either case.
 */
const MODALITY_ALIASES: ReadonlyMap<string, CanonicalModality> = new Map<string, CanonicalModality>(
  [
    // X-ray family
    ['x-ray', 'X-ray'],
    ['xray', 'X-ray'],
    ['x ray', 'X-ray'],
    ['radiograph', 'X-ray'],
    ['radiography', 'X-ray'],
    ['chest x-ray', 'X-ray'],
    ['cxr', 'X-ray'],
    ['dxr', 'X-ray'],
    ['cr', 'X-ray'], // computed radiography
    ['dr', 'X-ray'], // digital radiography

    // CT family
    ['ct', 'CT'],
    ['cat', 'CT'],
    ['cat scan', 'CT'],
    ['computed tomography', 'CT'],
    ['cta', 'CT'], // CT angiography

    // MRI family
    ['mri', 'MRI'],
    ['mr', 'MRI'],
    ['magnetic resonance', 'MRI'],
    ['magnetic resonance imaging', 'MRI'],
    ['mra', 'MRI'], // MR angiography
    ['fmri', 'MRI'],

    // Ultrasound
    ['ultrasound', 'Ultrasound'],
    ['us', 'Ultrasound'],
    ['echography', 'Ultrasound'],
    ['echocardiography', 'Ultrasound'],
    ['sonography', 'Ultrasound'],

    // Fundus / retinal photography
    ['fundus', 'Fundus'],
    ['retina', 'Fundus'],
    ['retinal photography', 'Fundus'],
    ['fundoscopy', 'Fundus'],
    ['cfp', 'Fundus'], // colour fundus photo
    ['oct', 'Fundus'], // optical coherence tomography — fundus-adjacent for annotation purposes

    // Pathology / histopathology / WSI
    ['pathology', 'Pathology'],
    ['histopathology', 'Pathology'],
    ['histology', 'Pathology'],
    ['wsi', 'Pathology'], // whole-slide imaging
    ['whole slide imaging', 'Pathology'],
    ['cytology', 'Pathology'],

    // Text / clinical notes
    ['text', 'Text'],
    ['note', 'Text'],
    ['notes', 'Text'],
    ['clinical note', 'Text'],
    ['clinical notes', 'Text'],
    ['report', 'Text'],
    ['radiology report', 'Text'],
    ['discharge summary', 'Text'],

    // EHR / structured clinical data
    ['ehr', 'EHR'],
    ['emr', 'EHR'],
    ['structured data', 'EHR'],

    // Transcripts
    ['transcript', 'Transcript'],
    ['conversation', 'Transcript'],
    ['speech transcript', 'Transcript'],

    // Time-series
    ['timeseries', 'Timeseries'],
    ['time series', 'Timeseries'],
    ['time-series', 'Timeseries'],
    ['signal', 'Timeseries'],

    // ECG / EEG
    ['ecg', 'ECG'],
    ['ekg', 'ECG'],
    ['electrocardiogram', 'ECG'],
    ['electrocardiography', 'ECG'],
    ['eeg', 'EEG'],
    ['electroencephalogram', 'EEG'],
    ['electroencephalography', 'EEG'],

    // Multi-modal / mixed
    ['mixed', 'Mixed'],
    ['multimodal', 'Mixed'],
    ['multi-modal', 'Mixed'],
    ['multi modal', 'Mixed'],
  ],
);

/**
 * Normalise a raw modality string (as it might appear in a Croissant
 * `bio:imagingModality` `name` / `termCode` slot) to a `CanonicalModality`
 * key. Returns `null` when the value isn't recognised — the caller
 * then either skips the value or applies the fallback policy.
 *
 * Matching is case-insensitive and trims surrounding whitespace. Common
 * separator variants (`X-ray` vs `xray` vs `X ray`) all resolve.
 */
export function canonicalizeModality(raw: string): CanonicalModality | null {
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  return MODALITY_ALIASES.get(key) ?? null;
}

/**
 * Compute the task-kind set allowed for a dataset given its persisted
 * `modalities` column. The set is the **union** across all recognised
 * modalities — a multi-modal dataset (e.g. CT + Text) allows the union
 * of both their permitted task kinds.
 *
 * Fallbacks (the issue's "don't block the manager" rule):
 *  - When `modalities` is empty → return **all** task kinds. The host
 *    hasn't declared structured modality metadata; the platform refuses
 *    to second-guess.
 *  - When every entry is unrecognised → same fallback. The caller
 *    (`api`) should log a warning so the host is nudged to publish
 *    modality metadata that matches the canonical vocabulary.
 *
 * Returns a stable-ordered array (matching the `CampaignTaskKind`
 * enum declaration order) so downstream UI / API responses don't
 * shuffle the set across requests.
 */
export function allowedTaskKindsForModalities(
  modalities: readonly string[],
): readonly CampaignTaskKind[] {
  if (modalities.length === 0) return ALL_TASK_KINDS;

  const canonical = new Set<CanonicalModality>();
  for (const raw of modalities) {
    const c = canonicalizeModality(raw);
    if (c !== null) canonical.add(c);
  }
  if (canonical.size === 0) return ALL_TASK_KINDS;

  const allowed = new Set<CampaignTaskKind>();
  for (const c of canonical) {
    // eslint-disable-next-line security/detect-object-injection -- typed enum keys
    for (const k of MODALITY_TASK_KIND_MAP[c]) allowed.add(k);
  }
  return ALL_TASK_KINDS.filter((k) => allowed.has(k));
}

/**
 * Short, user-facing rationale for *why* a task kind is disabled on
 * `/annotation/campaigns/new`. Used as a `title` / tooltip on the
 * disabled radio so the campaign manager isn't left guessing. The
 * exhaustive map of (modality, task) → reason isn't worthwhile — a
 * single sentence keyed off the canonical modalities of the dataset
 * is enough to orient the user; the linked docs carry the depth.
 */
export function rationaleForDisabledTaskKind(
  taskKind: CampaignTaskKind,
  rawModalities: readonly string[],
): string {
  const canonical = new Set<CanonicalModality>();
  for (const raw of rawModalities) {
    const c = canonicalizeModality(raw);
    if (c !== null) canonical.add(c);
  }
  const labels = [...canonical];
  const modalityList =
    labels.length === 0
      ? 'the selected dataset'
      : labels.length === 1
        ? `${labels[0]!} data`
        : `${labels.slice(0, -1).join(', ')} and ${labels.slice(-1)[0]!} data`;
  return (
    `${friendlyTaskKindLabel(taskKind)} isn't supported for ${modalityList}. ` +
    `Pick a compatible task kind, or change the dataset.`
  );
}

function friendlyTaskKindLabel(taskKind: CampaignTaskKind): string {
  switch (taskKind) {
    case 'CLASSIFICATION':
      return 'Classification';
    case 'DETECTION':
      return 'Detection';
    case 'SEGMENTATION':
      return 'Segmentation';
    case 'LOCALIZATION':
      return 'Localisation';
    case 'MULTI_MODAL':
      return 'Multi-modal';
  }
}
