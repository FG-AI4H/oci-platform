import { describe, expect, it } from 'vitest';
import { fromDicomSr, toDicomSr } from './dicom-sr.js';
import { type AnnotationRecord } from './types.js';

const PROV: AnnotationRecord['provenance'] = {
  annotatorSub: 'sub-1',
  role: 'annotator',
  toolIntegrationId: 'int-1',
  toolVersion: '1.2.0',
  schemaProfile: 'classification-v1',
  createdAt: '2026-05-29T00:00:00Z',
};

function record(payload: AnnotationRecord['payload']): AnnotationRecord {
  return {
    annotationId: 'a-1',
    sampleRef: '1.2.840.10008.1',
    modality: 'image-2d',
    payload,
    provenance: PROV,
  };
}

describe('DICOM SR round-trip (ADR-0008 DoD)', () => {
  it('classification with a coded finding + confidence round-trips (TID-1500)', () => {
    const payload = {
      kind: 'classification' as const,
      label: 'Pneumonia',
      confidence: 0.92,
      code: { codeValue: '233604007', codingScheme: 'SCT', codeMeaning: 'Pneumonia' },
    };
    const doc = toDicomSr(record(payload));
    expect(doc.templateId).toBe('1500');
    expect(doc.referencedSopInstanceUid).toBe('1.2.840.10008.1');
    expect(fromDicomSr(doc)).toEqual(payload);
  });

  it('classification with a free-text (uncoded) label round-trips without inventing a code', () => {
    const payload = { kind: 'classification' as const, label: 'atypical-finding' };
    const back = fromDicomSr(toDicomSr(record(payload)));
    expect(back).toEqual(payload);
    expect((back as { code?: unknown }).code).toBeUndefined();
  });

  it('multi-box bbox round-trips coordinates + labels exactly (TID-1410)', () => {
    const payload = {
      kind: 'bbox' as const,
      boxes: [
        { label: 'nodule', x: 10, y: 20, width: 30, height: 40 },
        { label: 'effusion', x: 100, y: 5, width: 12, height: 8 },
      ],
    };
    const doc = toDicomSr(record(payload));
    expect(doc.templateId).toBe('1410');
    expect(fromDicomSr(doc)).toEqual(payload);
  });
});
