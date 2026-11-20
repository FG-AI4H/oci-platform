import dicomParser from 'dicom-parser';
import type { DataSet } from 'dicom-parser';
import { elementText } from './element-text.js';
import { DATA_AFTER_PIXEL_DATA, collectFindings, sortFindings } from './findings.js';
import type { DicomInstanceHeader, DicomObjectKind, ParseDicomHeaderResult } from './types.js';

/** Parsing stops at PixelData: the server never reads pixels (ADR-0026). */
const PIXEL_DATA = 'x7fe00010';
const PREAMBLE_LENGTH = 128;
const MAGIC = [0x44, 0x49, 0x43, 0x4d]; // "DICM"
const DEFLATED_EXPLICIT_VR_LITTLE_ENDIAN = '1.2.840.10008.1.2.1.99';
/** Item delimiter that closes encapsulated pixel data: (FFFE,E0DD), length 0. */
const SEQUENCE_DELIMITER = [0xfe, 0xff, 0xdd, 0xe0, 0x00, 0x00, 0x00, 0x00];

/**
 * How far into a file a header is looked for. Real headers are a few
 * kilobytes; this bounds what a caller reads into memory for a file
 * that is marked as DICOM and is something else.
 */
export const DEFAULT_MAX_HEADER_BYTES = 4 * 1024 * 1024;

/**
 * True when the bytes carry the Part 10 marker. A file is DICOM by its
 * content, never by its name or its declared type: both are chosen by
 * the uploader.
 */
export function hasDicomMarker(bytes: Uint8Array): boolean {
  if (bytes.length < PREAMBLE_LENGTH + MAGIC.length) return false;
  return MAGIC.every((byte, i) => bytes[PREAMBLE_LENGTH + i] === byte);
}

/**
 * True when a file that holds encapsulated (compressed) pixel data ends
 * where that pixel data ends. `tail` is the last eight bytes of the
 * file, or more. See `pixelData` on the parse result.
 */
export function endsWithSequenceDelimiter(tail: Uint8Array): boolean {
  if (tail.length < SEQUENCE_DELIMITER.length) return false;
  const start = tail.length - SEQUENCE_DELIMITER.length;
  return SEQUENCE_DELIMITER.every((byte, i) => tail[start + i] === byte);
}

// DICOM decimal and integer strings, whole value: `parseFloat` would
// accept "3abc" as 3, and a guess is worse than no geometry.
// The decimal pattern only limits the characters; `Number` then rejects
// what is not one number ("1.2.3", "1e", "--1"), so no grouping is needed.
const DECIMAL = /^[0-9eE+.-]+$/;
const INTEGER = /^[+-]?\d+$/;

function numbers(dataSet: DataSet, tag: string, pattern: RegExp): number[] | null {
  const value = elementText(dataSet, tag);
  if (value === null) return null;
  const parts = value.split('\\').map((part) => part.trim());
  const values = parts.map((part) => (pattern.test(part) ? Number(part) : Number.NaN));
  return values.every((value) => Number.isFinite(value)) ? values : null;
}

function decimal(dataSet: DataSet, tag: string): number | null {
  return numbers(dataSet, tag, DECIMAL)?.[0] ?? null;
}

function integer(dataSet: DataSet, tag: string): number | null {
  return numbers(dataSet, tag, INTEGER)?.[0] ?? null;
}

function triple(values: number[] | null): [number, number, number] | null {
  if (values?.length !== 3) return null;
  const [a, b, c] = values as [number, number, number];
  return [a, b, c];
}

function sextuple(
  values: number[] | null,
): [number, number, number, number, number, number] | null {
  if (values?.length !== 6) return null;
  const [a, b, c, d, e, f] = values as [number, number, number, number, number, number];
  return [a, b, c, d, e, f];
}

function pair(values: number[] | null): [number, number] | null {
  if (values?.length !== 2) return null;
  const [a, b] = values as [number, number];
  return [a, b];
}

function unsigned(dataSet: DataSet, tag: string): number | null {
  // A US value is two bytes, and they must be inside the data: in an
  // implicit VR file cut short the library would read past the end.
  // `tag` is one of the constants below, never input.
  // eslint-disable-next-line security/detect-object-injection
  const element = dataSet.elements[tag];
  if (!element || element.length < 2) return null;
  if (element.dataOffset + 2 > dataSet.byteArray.length) {
    throw new Error(`dicom header: element ${tag} runs past the end of the data`);
  }
  return dataSet.uint16(tag) ?? null;
}

function readHeader(dataSet: DataSet): DicomInstanceHeader {
  return {
    sopClassUid: elementText(dataSet, 'x00080016'),
    sopInstanceUid: elementText(dataSet, 'x00080018'),
    studyInstanceUid: elementText(dataSet, 'x0020000d'),
    seriesInstanceUid: elementText(dataSet, 'x0020000e'),
    frameOfReferenceUid: elementText(dataSet, 'x00200052'),
    transferSyntaxUid: elementText(dataSet, 'x00020010'),
    modality: elementText(dataSet, 'x00080060'),
    seriesNumber: integer(dataSet, 'x00200011'),
    instanceNumber: integer(dataSet, 'x00200013'),
    imagePositionPatient: triple(numbers(dataSet, 'x00200032', DECIMAL)),
    imageOrientationPatient: sextuple(numbers(dataSet, 'x00200037', DECIMAL)),
    rows: unsigned(dataSet, 'x00280010'),
    columns: unsigned(dataSet, 'x00280011'),
    numberOfFrames: integer(dataSet, 'x00280008'),
    bitsAllocated: unsigned(dataSet, 'x00280100'),
    pixelRepresentation: unsigned(dataSet, 'x00280103'),
    photometricInterpretation: elementText(dataSet, 'x00280004'),
    sliceThickness: decimal(dataSet, 'x00180050'),
    pixelSpacing: pair(numbers(dataSet, 'x00280030', DECIMAL)),
    windowCenter: decimal(dataSet, 'x00281050'),
    windowWidth: decimal(dataSet, 'x00281051'),
    hasPixelData: PIXEL_DATA in dataSet.elements,
  };
}

function objectKind(header: DicomInstanceHeader): DicomObjectKind {
  if (!header.hasPixelData || !header.rows || !header.columns) return 'other';
  const frames = header.numberOfFrames ?? 1;
  if (frames < 1) return 'other';
  return frames > 1 ? 'multi-frame-image' : 'single-frame-image';
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

/**
 * Read one DICOM header from the first bytes of a file.
 *
 * `bytes` may be a prefix of the file; `totalSize` is the size of the
 * whole file. When the prefix stops before the header does, the result
 * is `truncated` and the caller reads a longer prefix, up to
 * `maxHeaderBytes`. Past that, or when the whole file was given, a
 * header that cannot be read is `unreadable`. Pixel data is never
 * needed: parsing stops at its tag.
 *
 * Never throws on any input.
 */
export function parseDicomHeader(
  bytes: Uint8Array,
  options: { totalSize: number; maxHeaderBytes?: number },
): ParseDicomHeaderResult {
  const limit = Math.min(options.totalSize, options.maxHeaderBytes ?? DEFAULT_MAX_HEADER_BYTES);
  const canReadMore = bytes.length < limit;

  if (!hasDicomMarker(bytes)) {
    return canReadMore && bytes.length < PREAMBLE_LENGTH + MAGIC.length
      ? { kind: 'truncated' }
      : { kind: 'not-dicom' };
  }

  // A plain view, never a Node Buffer: given a Buffer the library takes
  // a different path, including inflating deflated files in process.
  const view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let header: DicomInstanceHeader;
  let findings;
  let pixelData: { offset: number; length: number | null } | null = null;
  try {
    const meta = dicomParser.readPart10Header(view);
    if (elementText(meta, 'x00020010') === DEFLATED_EXPLICIT_VR_LITTLE_ENDIAN) {
      // Would mean inflating uploader-controlled bytes on the server.
      return { kind: 'unreadable', reason: 'the deflated transfer syntax is not supported' };
    }
    const dataSet = dicomParser.parseDicom(view, { untilTag: PIXEL_DATA });
    header = readHeader(dataSet);
    findings = collectFindings(dataSet);
    const element = dataSet.elements.x7fe00010;
    if (element) {
      pixelData = {
        offset: element.dataOffset,
        length: element.hadUndefinedLength ? null : element.length,
      };
    }
  } catch (err) {
    return canReadMore ? { kind: 'truncated' } : { kind: 'unreadable', reason: failureReason(err) };
  }

  // A prefix that ends cleanly between two elements parses without
  // error. Without PixelData it is indistinguishable from a complete
  // object that has none, so ask for more, up to the limit.
  if (pixelData === null && bytes.length < options.totalSize) {
    return canReadMore
      ? { kind: 'truncated' }
      : { kind: 'unreadable', reason: `no pixel data within the first ${limit} bytes` };
  }

  // Parsing stopped at PixelData, so anything written after it was not
  // examined. For uncompressed pixel data the end is known; say so if
  // the file goes on. For compressed pixel data the caller checks the
  // end of the file (`endsWithSequenceDelimiter`).
  if (
    pixelData !== null &&
    pixelData.length !== null &&
    pixelData.offset + pixelData.length < options.totalSize
  ) {
    findings = sortFindings([...findings, DATA_AFTER_PIXEL_DATA]);
  }

  return { kind: 'ok', header, objectKind: objectKind(header), findings, pixelData };
}
