import {
  UnsupportedPersistenceError,
  type AnnotationRecord,
  type BoundingBox,
  type CodedConcept,
  type DicomSrDocument,
  type SrContentItem,
} from './types.js';

/**
 * DICOM SR (Structured Reporting) derivation (ADR-0008): TID-1500 for
 * classification, TID-1410 for 2D ROI. Models the SR *content tree* as
 * JSON (not binary DICOM P10 — that encoding is a downstream concern);
 * `toDicomSr` ↔ `fromDicomSr` round-trip the internal payload.
 *
 * The coded concepts below are representative DICOM/SCT triplets; exact
 * terminology mapping per finding is the dataset host's concern and is
 * carried through `ClassificationPayload.code` when supplied.
 */

const REPORT_ROOT: CodedConcept = {
  codeValue: '126000',
  codingScheme: 'DCM',
  codeMeaning: 'Imaging Measurement Report',
};
const MEASUREMENT_GROUP: CodedConcept = {
  codeValue: '125007',
  codingScheme: 'DCM',
  codeMeaning: 'Measurement Group',
};
const FINDING: CodedConcept = { codeValue: '121071', codingScheme: 'DCM', codeMeaning: 'Finding' };
const CONFIDENCE: CodedConcept = {
  codeValue: '121412',
  codingScheme: 'DCM',
  codeMeaning: 'Confidence',
};
const RATIO_UNIT: CodedConcept = { codeValue: '1', codingScheme: 'UCUM', codeMeaning: 'ratio' };
const OUTLINE: CodedConcept = {
  codeValue: '111030',
  codingScheme: 'DCM',
  codeMeaning: 'Image Region',
};
/** Sentinel scheme marking a free-text label that has no coded form, so
 * `fromDicomSr` knows to surface it as `label` only (no `code`). */
const LOCAL_SCHEME = 'OCI_LOCAL';

function labelToCode(label: string, code?: CodedConcept): CodedConcept {
  return code ?? { codeValue: label, codingScheme: LOCAL_SCHEME, codeMeaning: label };
}
function codeToLabel(c: CodedConcept): { label: string; code?: CodedConcept } {
  return c.codingScheme === LOCAL_SCHEME
    ? { label: c.codeMeaning }
    : { label: c.codeMeaning, code: c };
}

/** Closed-polyline graphic data (5 points) for an axis-aligned box. */
function boxToPolyline(b: BoundingBox): number[] {
  return [
    b.x,
    b.y,
    b.x + b.width,
    b.y,
    b.x + b.width,
    b.y + b.height,
    b.x,
    b.y + b.height,
    b.x,
    b.y,
  ];
}
function polylineToBox(data: number[]): { x: number; y: number; width: number; height: number } {
  // Flat [x0,y0,x1,y1,…] → split into xs/ys by position parity (no
  // indexed access, so no object-injection sink on the array).
  const xs: number[] = [];
  const ys: number[] = [];
  data.forEach((v, idx) => (idx % 2 === 0 ? xs.push(v) : ys.push(v)));
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

export function toDicomSr(record: AnnotationRecord): DicomSrDocument {
  const payload = record.payload;
  if (payload.kind === 'classification') {
    const children: SrContentItem[] = [
      {
        valueType: 'CODE',
        conceptName: FINDING,
        conceptCode: labelToCode(payload.label, payload.code),
      },
    ];
    if (payload.confidence !== undefined) {
      children.push({
        valueType: 'NUM',
        conceptName: CONFIDENCE,
        value: payload.confidence,
        unit: RATIO_UNIT,
      });
    }
    return {
      templateId: '1500',
      referencedSopInstanceUid: record.sampleRef,
      root: { valueType: 'CONTAINER', conceptName: REPORT_ROOT, children },
    };
  }
  if (payload.kind === 'bbox') {
    const groups: SrContentItem[] = payload.boxes.map((b) => ({
      valueType: 'CONTAINER' as const,
      conceptName: MEASUREMENT_GROUP,
      children: [
        { valueType: 'CODE' as const, conceptName: FINDING, conceptCode: labelToCode(b.label) },
        {
          valueType: 'SCOORD' as const,
          conceptName: OUTLINE,
          graphicType: 'POLYLINE' as const,
          graphicData: boxToPolyline(b),
        },
      ],
    }));
    return {
      templateId: '1410',
      referencedSopInstanceUid: record.sampleRef,
      root: { valueType: 'CONTAINER', conceptName: REPORT_ROOT, children: groups },
    };
  }
  throw new UnsupportedPersistenceError(
    record.modality,
    (payload as { kind: string }).kind,
    'DICOM SR',
  );
}

/** Parse an SR document back to the payload (round-trip with `toDicomSr`). */
export function fromDicomSr(doc: DicomSrDocument): AnnotationRecord['payload'] {
  const children = doc.root.valueType === 'CONTAINER' ? doc.root.children : [];
  if (doc.templateId === '1500') {
    const codeItem = children.find((c) => c.valueType === 'CODE');
    if (!codeItem || codeItem.valueType !== 'CODE') {
      throw new Error('Malformed TID-1500 SR: missing finding CODE item');
    }
    const { label, code } = codeToLabel(codeItem.conceptCode);
    const numItem = children.find((c) => c.valueType === 'NUM');
    const confidence = numItem && numItem.valueType === 'NUM' ? numItem.value : undefined;
    return {
      kind: 'classification',
      label,
      ...(code ? { code } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
    };
  }
  if (doc.templateId === '1410') {
    const boxes: BoundingBox[] = children
      .filter((c) => c.valueType === 'CONTAINER')
      .map((group) => {
        if (group.valueType !== 'CONTAINER') throw new Error('unreachable');
        const codeItem = group.children.find((c) => c.valueType === 'CODE');
        const scoord = group.children.find((c) => c.valueType === 'SCOORD');
        if (
          !codeItem ||
          codeItem.valueType !== 'CODE' ||
          !scoord ||
          scoord.valueType !== 'SCOORD'
        ) {
          throw new Error('Malformed TID-1410 measurement group');
        }
        return {
          label: codeToLabel(codeItem.conceptCode).label,
          ...polylineToBox(scoord.graphicData),
        };
      });
    return { kind: 'bbox', boxes };
  }
  throw new UnsupportedPersistenceError('image', `template-${doc.templateId}`, 'DICOM SR');
}
