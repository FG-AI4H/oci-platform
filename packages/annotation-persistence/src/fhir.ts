import {
  UnsupportedPersistenceError,
  type AnnotationRecord,
  type FhirCoding,
  type FhirImagingSelection,
  type FhirObservation,
  type FhirPersistenceForm,
} from './types.js';

/**
 * FHIR R5 derivation (ADR-0008): an `Observation` carries the label and
 * an `ImagingSelection` carries the region pointer. Output is plain
 * FHIR-R5-shaped JSON (resourceType-tagged) so it validates against the
 * R5 schema and posts to a FHIR server unchanged.
 */

const DCM = 'http://dicom.nema.org/resources/ontology/DCM';
const IMAGING_FINDING: FhirCoding = { system: DCM, code: '121071', display: 'Finding' };
const REGION_OF_INTEREST: FhirCoding = { system: DCM, code: '111030', display: 'Image Region' };

export function toFhir(record: AnnotationRecord): FhirPersistenceForm {
  const payload = record.payload;
  const derivedFrom = [{ reference: `ImagingSelection/${record.annotationId}` }];

  if (payload.kind === 'classification') {
    const labelCoding: FhirCoding = payload.code
      ? {
          system: payload.code.codingScheme,
          code: payload.code.codeValue,
          display: payload.code.codeMeaning,
        }
      : { system: 'urn:oci:local-label', code: payload.label, display: payload.label };
    const observation: FhirObservation = {
      resourceType: 'Observation',
      status: 'final',
      code: { coding: [IMAGING_FINDING], text: 'Imaging finding' },
      valueCodeableConcept: { coding: [labelCoding], text: payload.label },
      derivedFrom,
      method: { text: `${record.provenance.toolIntegrationId}@${record.provenance.toolVersion}` },
    };
    const imagingSelection: FhirImagingSelection = {
      resourceType: 'ImagingSelection',
      status: 'available',
      instance: [{ uid: record.sampleRef }],
    };
    return { observation, imagingSelection };
  }

  if (payload.kind === 'bbox') {
    const observation: FhirObservation = {
      resourceType: 'Observation',
      status: 'final',
      code: { coding: [REGION_OF_INTEREST], text: 'Region of interest' },
      valueCodeableConcept: {
        coding: payload.boxes.map((b) => ({
          system: 'urn:oci:local-label',
          code: b.label,
          display: b.label,
        })),
        text: payload.boxes.map((b) => b.label).join(', '),
      },
      derivedFrom,
      method: { text: `${record.provenance.toolIntegrationId}@${record.provenance.toolVersion}` },
    };
    const imagingSelection: FhirImagingSelection = {
      resourceType: 'ImagingSelection',
      status: 'available',
      instance: [{ uid: record.sampleRef }],
      imageRegion2D: payload.boxes.map((b) => ({
        regionType: 'boundingbox',
        // FHIR boundingbox: two corner (x,y) pairs, flattened.
        coordinate: [b.x, b.y, b.x + b.width, b.y + b.height],
      })),
    };
    return { observation, imagingSelection };
  }

  throw new UnsupportedPersistenceError(
    record.modality,
    (payload as { kind: string }).kind,
    'FHIR R5',
  );
}
