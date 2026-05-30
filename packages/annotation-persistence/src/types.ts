/**
 * Internal source-of-truth + canonical persistence-form types (ADR-0008
 * §"Three canonical persistence forms"). The `AnnotationRecord` is the
 * single JSONB-shaped source of truth; the three forms are derived from
 * it on demand and never stored in parallel.
 *
 * This package is pure (no DB, no Prisma). The payload has already been
 * validated against the tool version's Zod `schemaProfile` upstream
 * (ADR-0007 / the annotation module's schema-profile registry); these
 * derivations assume a well-formed record.
 */

export type AnnotationModality =
  | 'image-2d'
  | 'image-3d'
  | 'video'
  | 'audio'
  | 'text'
  | 'multimodal';

/** Coded concept (DICOM-style triplet; reused for FHIR codings). */
export interface CodedConcept {
  codeValue: string;
  codingScheme: string; // e.g. 'DCM', 'SCT' (SNOMED CT), 'LN' (LOINC)
  codeMeaning: string;
}

/** Provenance recorded with every accepted annotation (ADR-0008 §Provenance). */
export interface AnnotationProvenance {
  /** GA4GH Passport `sub` of the annotator (ADR-0003). */
  annotatorSub: string;
  role: string;
  toolIntegrationId: string;
  toolVersion: string;
  schemaProfile: string;
  createdAt: string; // ISO 8601
  durationSeconds?: number;
  irrSampleTag?: boolean;
  /** What the annotator could see at submission (ADR-0010). */
  metadataExposureProfile?: {
    visibilityConfigHash: string;
    visibilityConfigVersion: string;
    deliveredFields: string[];
  };
  /** Merkle-style hash chain over payload + provenance (ADR-0008). */
  hashChain?: { sha256: string; prevSha256: string | null };
}

/** Classification result — a single coded/label finding. */
export interface ClassificationPayload {
  kind: 'classification';
  label: string;
  confidence?: number;
  /** Optional coded form (preferred for regulator-facing SR/FHIR). */
  code?: CodedConcept;
}

/** One axis-aligned 2D bounding box, in pixel coordinates. */
export interface BoundingBox {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 2D region-of-interest result — one or more bounding boxes. */
export interface BboxPayload {
  kind: 'bbox';
  boxes: BoundingBox[];
}

/** image-2d payloads supported in this slice (Phase B.A.3 starting set). */
export type AnnotationPayload = ClassificationPayload | BboxPayload;

/** The internal source-of-truth for one accepted annotation. */
export interface AnnotationRecord {
  annotationId: string;
  /** Stable reference to the underlying sample (DICOM SOP instance UID, etc.). */
  sampleRef: string;
  modality: AnnotationModality;
  payload: AnnotationPayload;
  provenance: AnnotationProvenance;
}

/** Thrown when a (modality, annotationType) pair isn't implemented yet —
 * persistence rolls out incrementally per modality (ADR-0008 §Per-modality
 * implementation order). */
export class UnsupportedPersistenceError extends Error {
  constructor(modality: string, kind: string, form: string) {
    super(
      `Persistence form '${form}' not yet implemented for modality='${modality}', payload kind='${kind}'`,
    );
    this.name = 'UnsupportedPersistenceError';
  }
}

// --- Canonical form 1: DICOM SR content tree ---------------------------------

export type SrGraphicType = 'POINT' | 'POLYLINE' | 'CIRCLE' | 'ELLIPSE';

export type SrContentItem =
  | { valueType: 'CONTAINER'; conceptName: CodedConcept; children: SrContentItem[] }
  | { valueType: 'CODE'; conceptName: CodedConcept; conceptCode: CodedConcept }
  | { valueType: 'TEXT'; conceptName: CodedConcept; text: string }
  | { valueType: 'NUM'; conceptName: CodedConcept; value: number; unit: CodedConcept }
  | {
      valueType: 'SCOORD';
      conceptName: CodedConcept;
      graphicType: SrGraphicType;
      graphicData: number[];
    }
  | { valueType: 'UIDREF'; conceptName: CodedConcept; uid: string };

export interface DicomSrDocument {
  /** TID-1500 (classification) | TID-1410 (2D ROI) | TID-1411 (3D ROI). */
  templateId: '1500' | '1410' | '1411';
  /** SOP instance the SR refers to (the sample). */
  referencedSopInstanceUid: string;
  root: SrContentItem; // CONTAINER
}

// --- Canonical form 2: FHIR R5 -----------------------------------------------

export interface FhirCoding {
  system: string;
  code: string;
  display: string;
}

export interface FhirObservation {
  resourceType: 'Observation';
  status: 'final';
  code: { coding: FhirCoding[]; text: string };
  valueCodeableConcept?: { coding: FhirCoding[]; text: string };
  derivedFrom?: { reference: string }[];
  method?: { text: string };
}

export interface FhirImagingSelection {
  resourceType: 'ImagingSelection';
  status: 'available';
  /** SOP instance pointer for the sample. */
  instance: { uid: string }[];
  /** 2D regions, if any (FHIR ImagingSelection.imageRegion2D). */
  imageRegion2D?: { regionType: 'boundingbox' | 'point' | 'polyline'; coordinate: number[] }[];
}

export interface FhirPersistenceForm {
  observation: FhirObservation;
  imagingSelection: FhirImagingSelection;
}

// --- Canonical form 3: Croissant-RAI distribution entry ----------------------

/** A Croissant 1.1 + RAI distribution entry for the annotation output —
 * appended to the catalog dataset's manifest (ADR-0008 / ADR-0002). */
export interface CroissantRaiEntry {
  '@type': 'cr:FileObject';
  '@id': string;
  name: string;
  description: string;
  encodingFormat: 'application/json';
  /** RAI annotation provenance block. */
  'rai:annotation': {
    annotationId: string;
    annotationType: AnnotationPayload['kind'];
    modality: AnnotationModality;
    sampleRef: string;
    tool: { id: string; version: string };
    schemaProfile: string;
    createdAt: string;
    annotatorSub: string;
    metadataExposureConfigHash?: string;
    contentHash?: string;
  };
}

export interface PersistenceForms {
  dicomSr: DicomSrDocument;
  fhir: FhirPersistenceForm;
  croissantRai: CroissantRaiEntry;
}
