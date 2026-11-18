/**
 * What the series index keeps about one DICOM instance (ADR-0026).
 *
 * Everything here comes from the header. Free-text descriptions are
 * left out on purpose: they are where identifying text hides, and the
 * viewer does not need them.
 */
export interface DicomInstanceHeader {
  sopClassUid: string | null;
  sopInstanceUid: string | null;
  studyInstanceUid: string | null;
  seriesInstanceUid: string | null;
  frameOfReferenceUid: string | null;
  transferSyntaxUid: string | null;
  modality: string | null;
  seriesNumber: number | null;
  instanceNumber: number | null;
  /** x, y, z of the first pixel, in millimetres, patient coordinates. */
  imagePositionPatient: [number, number, number] | null;
  /** Row direction cosines, then column direction cosines. */
  imageOrientationPatient: [number, number, number, number, number, number] | null;
  rows: number | null;
  columns: number | null;
  numberOfFrames: number | null;
  bitsAllocated: number | null;
  pixelRepresentation: number | null;
  photometricInterpretation: string | null;
  sliceThickness: number | null;
  /** Row spacing, then column spacing, in millimetres. */
  pixelSpacing: [number, number] | null;
  /** First value when the file declares several windows. */
  windowCenter: number | null;
  windowWidth: number | null;
  hasPixelData: boolean;
}

/**
 * Only `single-frame-image` instances are offered to the built-in
 * viewer. The others are indexed as present and not displayed.
 */
export type DicomObjectKind = 'single-frame-image' | 'multi-frame-image' | 'other';

/**
 * A populated attribute that de-identification normally empties,
 * removes or replaces. A finding is a warning, not a verdict: the
 * value may be a code. An operator decides (ADR-0026).
 *
 * `value` is the header's own text and may identify a patient. Callers
 * must not store or log it; keep a keyed digest instead.
 */
export interface DeidentificationFinding {
  /** DICOM keyword, or `PrivateTags` / `BurnedInAnnotation`. */
  attribute: string;
  /** `ggggeeee`, lower-case hex; null for `PrivateTags`. */
  tag: string | null;
  value: string;
}

export type ParseDicomHeaderResult =
  /** No `DICM` marker at byte 128: not a DICOM Part 10 file. */
  | { kind: 'not-dicom' }
  /** The bytes given stop before the header ends: read more and retry. */
  | { kind: 'truncated' }
  /** Marked as DICOM but the header cannot be read. */
  | { kind: 'unreadable'; reason: string }
  | {
      kind: 'ok';
      header: DicomInstanceHeader;
      objectKind: DicomObjectKind;
      findings: DeidentificationFinding[];
    };
