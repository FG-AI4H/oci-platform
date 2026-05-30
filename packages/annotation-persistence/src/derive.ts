import { toCroissantRaiEntry } from './croissant-rai.js';
import { toDicomSr } from './dicom-sr.js';
import { toFhir } from './fhir.js';
import { type AnnotationRecord, type PersistenceForms } from './types.js';

/**
 * Derive all three canonical persistence forms from the internal
 * source-of-truth (ADR-0008 §"Three canonical persistence forms"). The
 * forms are derived on demand here; callers cache them (e.g. on the
 * Annotation row) rather than storing parallel copies.
 */
export function derivePersistenceForms(record: AnnotationRecord): PersistenceForms {
  return {
    dicomSr: toDicomSr(record),
    fhir: toFhir(record),
    croissantRai: toCroissantRaiEntry(record),
  };
}
