import dicomParser from 'dicom-parser';
import type { DataSet } from 'dicom-parser';
import { collectFindings } from './findings.js';
import type { DicomInstanceHeader, DicomObjectKind, ParseDicomHeaderResult } from './types.js';

/** Parsing stops at PixelData: the server never reads pixels (ADR-0026). */
const PIXEL_DATA = 'x7fe00010';
const PREAMBLE_LENGTH = 128;
const MAGIC = [0x44, 0x49, 0x43, 0x4d]; // "DICM"

/**
 * True when the bytes carry the Part 10 marker. A file is DICOM by its
 * content, never by its name or its declared type: both are chosen by
 * the uploader.
 */
export function hasDicomMarker(bytes: Uint8Array): boolean {
  if (bytes.length < PREAMBLE_LENGTH + MAGIC.length) return false;
  return MAGIC.every((byte, i) => bytes[PREAMBLE_LENGTH + i] === byte);
}

function text(dataSet: DataSet, tag: string): string | null {
  const value = dataSet.string(tag);
  if (value === undefined) return null;
  const trimmed = value.replace(/\0/g, '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function integer(dataSet: DataSet, tag: string): number | null {
  const value = text(dataSet, tag);
  if (value === null) return null;
  const first = value.split('\\')[0] ?? '';
  const parsed = Number.parseInt(first, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function decimals(dataSet: DataSet, tag: string): number[] | null {
  const value = text(dataSet, tag);
  if (value === null) return null;
  const parts = value.split('\\').map((part) => Number.parseFloat(part));
  return parts.every((part) => Number.isFinite(part)) ? parts : null;
}

function decimal(dataSet: DataSet, tag: string): number | null {
  return decimals(dataSet, tag)?.[0] ?? null;
}

function tuple<N extends number>(values: number[] | null, length: N): number[] | null {
  return values !== null && values.length === length ? values : null;
}

function unsigned(dataSet: DataSet, tag: string): number | null {
  // A US value is two bytes. On a shorter element `uint16` would read
  // into whatever follows, so the length is checked first. `tag` is one
  // of the constants below, never input.
  // eslint-disable-next-line security/detect-object-injection
  const element = dataSet.elements[tag];
  if (!element || element.length < 2) return null;
  return dataSet.uint16(tag) ?? null;
}

function readHeader(dataSet: DataSet): DicomInstanceHeader {
  return {
    sopClassUid: text(dataSet, 'x00080016'),
    sopInstanceUid: text(dataSet, 'x00080018'),
    studyInstanceUid: text(dataSet, 'x0020000d'),
    seriesInstanceUid: text(dataSet, 'x0020000e'),
    frameOfReferenceUid: text(dataSet, 'x00200052'),
    transferSyntaxUid: text(dataSet, 'x00020010'),
    modality: text(dataSet, 'x00080060'),
    seriesNumber: integer(dataSet, 'x00200011'),
    instanceNumber: integer(dataSet, 'x00200013'),
    imagePositionPatient: tuple(decimals(dataSet, 'x00200032'), 3) as
      | [number, number, number]
      | null,
    imageOrientationPatient: tuple(decimals(dataSet, 'x00200037'), 6) as
      | [number, number, number, number, number, number]
      | null,
    rows: unsigned(dataSet, 'x00280010'),
    columns: unsigned(dataSet, 'x00280011'),
    numberOfFrames: integer(dataSet, 'x00280008'),
    bitsAllocated: unsigned(dataSet, 'x00280100'),
    pixelRepresentation: unsigned(dataSet, 'x00280103'),
    photometricInterpretation: text(dataSet, 'x00280004'),
    sliceThickness: decimal(dataSet, 'x00180050'),
    pixelSpacing: tuple(decimals(dataSet, 'x00280030'), 2) as [number, number] | null,
    windowCenter: decimal(dataSet, 'x00281050'),
    windowWidth: decimal(dataSet, 'x00281051'),
    hasPixelData: PIXEL_DATA in dataSet.elements,
  };
}

/**
 * The library throws plain strings, Errors, and for a failure part-way
 * through a file an object of the form `{ exception, dataSet }`. Its
 * messages name the tag and the position, never a value.
 */
function failureReason(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && err !== null && 'exception' in err) {
    return failureReason((err as { exception: unknown }).exception);
  }
  return 'the header could not be parsed';
}

function objectKind(header: DicomInstanceHeader): DicomObjectKind {
  if (!header.hasPixelData || header.rows === null || header.columns === null) return 'other';
  return (header.numberOfFrames ?? 1) > 1 ? 'multi-frame-image' : 'single-frame-image';
}

/**
 * Read one DICOM header from the first bytes of a file.
 *
 * `bytes` may be a prefix of the file; `totalSize` is the size of the
 * whole file. When the prefix stops before the header does, the result
 * is `truncated` and the caller reads a longer prefix. Pixel data is
 * never needed: parsing stops at its tag.
 */
export function parseDicomHeader(
  bytes: Uint8Array,
  options: { totalSize: number },
): ParseDicomHeaderResult {
  const isPrefix = bytes.length < options.totalSize;
  if (!hasDicomMarker(bytes)) {
    return isPrefix && bytes.length < PREAMBLE_LENGTH + MAGIC.length
      ? { kind: 'truncated' }
      : { kind: 'not-dicom' };
  }

  let dataSet: DataSet;
  try {
    dataSet = dicomParser.parseDicom(bytes, { untilTag: PIXEL_DATA });
  } catch (err) {
    if (isPrefix) return { kind: 'truncated' };
    return { kind: 'unreadable', reason: failureReason(err) };
  }

  const header = readHeader(dataSet);
  // A prefix that ends cleanly between two elements parses without
  // error. Without PixelData it is indistinguishable from a complete
  // non-image object, so ask for more.
  if (!header.hasPixelData && isPrefix) return { kind: 'truncated' };

  return {
    kind: 'ok',
    header,
    objectKind: objectKind(header),
    findings: collectFindings(dataSet),
  };
}
