/* eslint-disable security/detect-non-literal-fs-filename -- every path is under the folder the operator gave on the command line */
import { createHash } from 'node:crypto';
import { closeSync, fstatSync, lstatSync, openSync, readdirSync, readSync } from 'node:fs';
import path from 'node:path';
import {
  DATA_AFTER_PIXEL_DATA,
  DEFAULT_MAX_HEADER_BYTES,
  endsWithSequenceDelimiter,
  parseDicomHeader,
  sortFindings,
  type ParseDicomHeaderResult,
} from '@oci/dicom';

/**
 * Reading a sample folder from disk: which files it holds, and for each
 * file its size, its SHA-256 and what `@oci/dicom` makes of its header.
 *
 * The header is read exactly as the platform reads it after an upload
 * (`DicomIndexService.indexStoredObject`): the first bytes only, more
 * when the header runs on, never the pixel data, and the last eight
 * bytes when the pixel data is compressed. The loop is repeated here
 * because the platform's copy reads from object storage; the parser,
 * the attribute list and the findings are the platform's own.
 */

/** Real headers are a few kilobytes; one read is almost always enough. */
const FIRST_READ_BYTES = 64 * 1024;
/** The item that closes compressed pixel data is eight bytes long. */
const TAIL_BYTES = 8;
const HASH_CHUNK_BYTES = 1024 * 1024;

export interface FolderListing {
  /** Regular files, as paths relative to the folder, `/`-separated, sorted. */
  files: string[];
  /** Entries that are not regular files or folders (links, devices): never read. */
  notRegular: string[];
}

/** Every file under `folder`. Symbolic links are listed, never followed. */
export function listFolder(folder: string): FolderListing {
  const files: string[] = [];
  const notRegular: string[] = [];
  const visit = (relative: string): void => {
    const names = readdirSync(path.join(folder, relative)).sort();
    for (const name of names) {
      const child = relative === '' ? name : `${relative}/${name}`;
      const stat = lstatSync(path.join(folder, child));
      if (stat.isDirectory()) visit(child);
      else if (stat.isFile()) files.push(child);
      else notRegular.push(child);
    }
  };
  visit('');
  return { files, notRegular };
}

export type HeaderReading = Exclude<ParseDicomHeaderResult, { kind: 'truncated' }>;

export interface SampleFile {
  sizeBytes: number;
  /** Lower-case hex, of the whole file. */
  sha256: string;
  header: HeaderReading;
}

function readAt(fd: number, position: number, length: number): Uint8Array {
  const buffer = new Uint8Array(length);
  let filled = 0;
  while (filled < length) {
    const read = readSync(fd, buffer, filled, length - filled, position + filled);
    if (read === 0) break;
    filled += read;
  }
  return buffer.subarray(0, filled);
}

function hashFile(fd: number, sizeBytes: number): string {
  const hash = createHash('sha256');
  for (let position = 0; position < sizeBytes; position += HASH_CHUNK_BYTES) {
    hash.update(readAt(fd, position, Math.min(HASH_CHUNK_BYTES, sizeBytes - position)));
  }
  return hash.digest('hex');
}

function readHeader(fd: number, sizeBytes: number): HeaderReading {
  const limit = Math.min(sizeBytes, DEFAULT_MAX_HEADER_BYTES);
  let bytes = readAt(fd, 0, Math.min(FIRST_READ_BYTES, sizeBytes));
  let result = parseDicomHeader(bytes, { totalSize: sizeBytes });
  while (result.kind === 'truncated') {
    if (bytes.length >= limit) {
      // The parser stops asking at the limit; this only guards the loop.
      return { kind: 'unreadable', reason: 'the header could not be read within the limit' };
    }
    bytes = readAt(fd, 0, Math.min(limit, bytes.length * 4));
    result = parseDicomHeader(bytes, { totalSize: sizeBytes });
  }
  if (result.kind !== 'ok') return result;

  // Compressed pixel data does not say where it ends. If the file does
  // not end with the closing item, something follows that was not read.
  if (result.pixelData !== null && result.pixelData.length === null) {
    const tail = readAt(fd, Math.max(0, sizeBytes - TAIL_BYTES), TAIL_BYTES);
    if (!endsWithSequenceDelimiter(tail)) {
      return { ...result, findings: sortFindings([...result.findings, DATA_AFTER_PIXEL_DATA]) };
    }
  }
  return result;
}

/** Size, checksum and header of one file. Reads the file twice; never keeps it in memory. */
export function readSampleFile(absolutePath: string): SampleFile {
  const fd = openSync(absolutePath, 'r');
  try {
    const sizeBytes = fstatSync(fd).size;
    return { sizeBytes, sha256: hashFile(fd, sizeBytes), header: readHeader(fd, sizeBytes) };
  } finally {
    closeSync(fd);
  }
}

/** Checksum only, for comparing a folder with a record made earlier. */
export function checksumOf(absolutePath: string): { sizeBytes: number; sha256: string } {
  const fd = openSync(absolutePath, 'r');
  try {
    const sizeBytes = fstatSync(fd).size;
    return { sizeBytes, sha256: hashFile(fd, sizeBytes) };
  } finally {
    closeSync(fd);
  }
}
