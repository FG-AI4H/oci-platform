import { describe, expect, it } from 'vitest';
import {
  MODALITY_TASK_KIND_MAP,
  allowedTaskKindsForModalities,
  canonicalizeModality,
  rationaleForDisabledTaskKind,
} from './modality-task-kinds.js';

describe('canonicalizeModality', () => {
  it.each([
    ['X-ray', 'X-ray'],
    ['x-ray', 'X-ray'],
    ['  X-RAY  ', 'X-ray'],
    ['xray', 'X-ray'],
    ['CXR', 'X-ray'],
    ['Chest X-ray', 'X-ray'],
    ['Radiograph', 'X-ray'],
    ['CT', 'CT'],
    ['Computed Tomography', 'CT'],
    ['MRI', 'MRI'],
    ['fMRI', 'MRI'],
    ['Ultrasound', 'Ultrasound'],
    ['Echocardiography', 'Ultrasound'],
    ['Fundus', 'Fundus'],
    ['OCT', 'Fundus'],
    ['Pathology', 'Pathology'],
    ['WSI', 'Pathology'],
    ['Histopathology', 'Pathology'],
    ['Text', 'Text'],
    ['clinical note', 'Text'],
    ['radiology report', 'Text'],
    ['EHR', 'EHR'],
    ['EMR', 'EHR'],
    ['Transcript', 'Transcript'],
    ['Timeseries', 'Timeseries'],
    ['time-series', 'Timeseries'],
    ['ECG', 'ECG'],
    ['EKG', 'ECG'],
    ['EEG', 'EEG'],
    ['Mixed', 'Mixed'],
    ['multi-modal', 'Mixed'],
  ])('"%s" → %s', (raw, expected) => {
    expect(canonicalizeModality(raw)).toBe(expected);
  });

  it('returns null for empty + unrecognised values', () => {
    expect(canonicalizeModality('')).toBeNull();
    expect(canonicalizeModality('   ')).toBeNull();
    expect(canonicalizeModality('genomics')).toBeNull();
    expect(canonicalizeModality('proteomics')).toBeNull();
  });
});

describe('allowedTaskKindsForModalities', () => {
  it('X-ray dataset allows imaging task kinds', () => {
    expect([...allowedTaskKindsForModalities(['X-ray'])]).toEqual([
      'CLASSIFICATION',
      'DETECTION',
      'SEGMENTATION',
      'LOCALIZATION',
    ]);
  });

  it('Text dataset allows CLASSIFICATION + MULTI_MODAL only', () => {
    expect([...allowedTaskKindsForModalities(['Text'])]).toEqual(['CLASSIFICATION', 'MULTI_MODAL']);
  });

  it('Timeseries dataset allows CLASSIFICATION only', () => {
    expect([...allowedTaskKindsForModalities(['Timeseries'])]).toEqual(['CLASSIFICATION']);
  });

  it('ECG dataset allows CLASSIFICATION only', () => {
    expect([...allowedTaskKindsForModalities(['ECG'])]).toEqual(['CLASSIFICATION']);
  });

  it('returns the union for multi-modality datasets', () => {
    // CT (imaging — segmentation OK) + Text (no segmentation)
    expect([...allowedTaskKindsForModalities(['CT', 'Text'])]).toEqual([
      'CLASSIFICATION',
      'DETECTION',
      'SEGMENTATION',
      'LOCALIZATION',
      'MULTI_MODAL',
    ]);
  });

  it('Mixed allows the full task-kind set (catch-all)', () => {
    expect([...allowedTaskKindsForModalities(['Mixed'])]).toEqual([
      'CLASSIFICATION',
      'DETECTION',
      'SEGMENTATION',
      'LOCALIZATION',
      'MULTI_MODAL',
    ]);
  });

  it('falls back to ALL task kinds when modalities is empty (host has not declared)', () => {
    expect([...allowedTaskKindsForModalities([])]).toEqual([
      'CLASSIFICATION',
      'DETECTION',
      'SEGMENTATION',
      'LOCALIZATION',
      'MULTI_MODAL',
    ]);
  });

  it('falls back to ALL task kinds when every entry is unrecognised', () => {
    expect([...allowedTaskKindsForModalities(['Genomics', 'Proteomics'])]).toEqual([
      'CLASSIFICATION',
      'DETECTION',
      'SEGMENTATION',
      'LOCALIZATION',
      'MULTI_MODAL',
    ]);
  });

  it('is case- and synonym-insensitive', () => {
    expect([...allowedTaskKindsForModalities(['cxr', 'chest x-ray'])]).toEqual([
      'CLASSIFICATION',
      'DETECTION',
      'SEGMENTATION',
      'LOCALIZATION',
    ]);
  });
});

describe('MODALITY_TASK_KIND_MAP', () => {
  it('every canonical modality has at least one allowed task kind', () => {
    for (const [modality, kinds] of Object.entries(MODALITY_TASK_KIND_MAP)) {
      expect(kinds.length, `${modality} has no allowed task kinds`).toBeGreaterThan(0);
    }
  });

  it('Mixed allows every task kind (catch-all)', () => {
    expect([...MODALITY_TASK_KIND_MAP.Mixed]).toEqual([
      'CLASSIFICATION',
      'DETECTION',
      'SEGMENTATION',
      'LOCALIZATION',
      'MULTI_MODAL',
    ]);
  });
});

describe('rationaleForDisabledTaskKind', () => {
  it('names the disabled task + the dataset modality', () => {
    expect(rationaleForDisabledTaskKind('SEGMENTATION', ['Text'])).toMatch(
      /Segmentation isn't supported for Text data/,
    );
  });

  it('joins multiple modalities with "and"', () => {
    expect(rationaleForDisabledTaskKind('DETECTION', ['Timeseries', 'EHR'])).toMatch(
      /Timeseries and EHR data/,
    );
  });

  it('falls back to a generic phrase when no canonical modality is detected', () => {
    expect(rationaleForDisabledTaskKind('SEGMENTATION', ['some-other-thing'])).toMatch(
      /the selected dataset/,
    );
  });
});
