import { describe, expect, it } from 'vitest';
import { derivePersistenceForms } from './derive.js';
import { toDicomSr } from './dicom-sr.js';
import { toFhir } from './fhir.js';
import { toCroissantRaiEntry } from './croissant-rai.js';
import { UnsupportedPersistenceError, type AnnotationRecord } from './types.js';

const PROV: AnnotationRecord['provenance'] = {
  annotatorSub: 'sub-1',
  role: 'annotator',
  toolIntegrationId: 'monai-label',
  toolVersion: '1.2.0',
  schemaProfile: 'classification-v1',
  createdAt: '2026-05-29T00:00:00Z',
  metadataExposureProfile: {
    visibilityConfigHash: 'abc',
    visibilityConfigVersion: 'v1',
    deliveredFields: ['modality'],
  },
  hashChain: { sha256: 'deadbeef', prevSha256: null },
};

const CLASSIFICATION: AnnotationRecord = {
  annotationId: 'a-1',
  sampleRef: '1.2.840.10008.1',
  modality: 'image-2d',
  payload: { kind: 'classification', label: 'Pneumonia', confidence: 0.9 },
  provenance: PROV,
};

const BBOX: AnnotationRecord = {
  ...CLASSIFICATION,
  annotationId: 'a-2',
  payload: { kind: 'bbox', boxes: [{ label: 'nodule', x: 1, y: 2, width: 3, height: 4 }] },
};

describe('FHIR R5 derivation', () => {
  it('classification → Observation carries the label; ImagingSelection points at the sample', () => {
    const { observation, imagingSelection } = toFhir(CLASSIFICATION);
    expect(observation.resourceType).toBe('Observation');
    expect(observation.status).toBe('final');
    expect(observation.valueCodeableConcept?.text).toBe('Pneumonia');
    expect(imagingSelection.instance[0]?.uid).toBe('1.2.840.10008.1');
  });

  it('bbox → ImagingSelection has one 2D region per box', () => {
    const { imagingSelection } = toFhir(BBOX);
    expect(imagingSelection.imageRegion2D).toHaveLength(1);
    expect(imagingSelection.imageRegion2D?.[0]?.regionType).toBe('boundingbox');
  });
});

describe('Croissant-RAI derivation', () => {
  it('emits a cr:FileObject with an rai:annotation provenance block', () => {
    const entry = toCroissantRaiEntry(CLASSIFICATION);
    expect(entry['@type']).toBe('cr:FileObject');
    expect(entry['rai:annotation'].annotationId).toBe('a-1');
    expect(entry['rai:annotation'].tool).toEqual({ id: 'monai-label', version: '1.2.0' });
    expect(entry['rai:annotation'].metadataExposureConfigHash).toBe('abc');
    expect(entry['rai:annotation'].contentHash).toBe('deadbeef');
  });
});

describe('derivePersistenceForms', () => {
  it('derives all three forms from one source-of-truth record', () => {
    const forms = derivePersistenceForms(BBOX);
    expect(forms.dicomSr.templateId).toBe('1410');
    expect(forms.fhir.observation.resourceType).toBe('Observation');
    expect(forms.croissantRai['@type']).toBe('cr:FileObject');
  });

  it('throws UnsupportedPersistenceError for a not-yet-implemented payload kind', () => {
    const seg = {
      ...CLASSIFICATION,
      payload: { kind: 'segmentation' } as unknown as AnnotationRecord['payload'],
    };
    expect(() => toDicomSr(seg)).toThrow(UnsupportedPersistenceError);
  });
});
