import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hasDicomMarker, parseDicomHeader } from './parse-header.js';
import {
  IMPLICIT_VR_LITTLE_ENDIAN,
  buildPart10,
  ctSlice,
  type TestElement,
} from './test-support/build-part10.js';
import type { ParseDicomHeaderResult } from './types.js';

const FIXTURES = fileURLToPath(new URL('../fixtures/rider-lung-ct/', import.meta.url));

interface FixtureEntry {
  file: string;
  headerBytes: number;
  originalBytes: number;
  transferSyntaxUid: string;
}
const manifest = JSON.parse(readFileSync(`${FIXTURES}manifest.json`, 'utf8')) as FixtureEntry[];

function ok(result: ParseDicomHeaderResult) {
  if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.kind}`);
  return result;
}

function parseWhole(bytes: Uint8Array) {
  return parseDicomHeader(bytes, { totalSize: bytes.length });
}

function attributes(result: ParseDicomHeaderResult): string[] {
  return ok(result).findings.map((finding) => finding.attribute);
}

describe('parseDicomHeader on real headers (RIDER Lung CT, three transfer syntaxes)', () => {
  // The fixtures are the header bytes of real public files, cut where
  // pixel data starts. The parser is given the size of the whole file,
  // which is exactly how the API calls it on a ranged read.
  it.each(manifest)('reads $file without its pixel data', (entry) => {
    const bytes = new Uint8Array(readFileSync(`${FIXTURES}${entry.file}`));
    expect(bytes.length).toBe(entry.headerBytes);

    const { header, objectKind } = ok(parseDicomHeader(bytes, { totalSize: entry.originalBytes }));

    expect(header.transferSyntaxUid).toBe(entry.transferSyntaxUid);
    expect(header.modality).toBe('CT');
    expect(header.sopClassUid).toBe('1.2.840.10008.5.1.4.1.1.2');
    expect(header.seriesInstanceUid).toBe(
      '1.3.6.1.4.1.14519.5.2.1.225437654119160983232862425601233799969',
    );
    expect(header.rows).toBe(512);
    expect(header.columns).toBe(512);
    expect(header.bitsAllocated).toBe(16);
    expect(header.pixelRepresentation).toBe(1);
    expect(header.sliceThickness).toBe(5);
    expect(header.pixelSpacing).toEqual([0.519531, 0.519531]);
    expect(header.windowCenter).toBe(-650);
    expect(header.windowWidth).toBe(1500);
    expect(header.imageOrientationPatient).toHaveLength(6);
    expect(header.hasPixelData).toBe(true);
    expect(objectKind).toBe('single-frame-image');
  });

  it('reports the codes a de-identified public file still carries', () => {
    const entry = manifest[0];
    if (!entry) throw new Error('fixture manifest is empty');
    const bytes = new Uint8Array(readFileSync(`${FIXTURES}${entry.file}`));
    const result = ok(parseDicomHeader(bytes, { totalSize: entry.originalBytes }));

    // Populated, and not identifying: this is why a finding is a
    // warning an operator decides on, not a refusal (ADR-0026).
    expect(result.findings).toContainEqual({
      attribute: 'PatientName',
      tag: '00100010',
      value: '573377',
    });
    expect(result.findings).toContainEqual({
      attribute: 'PatientID',
      tag: '00100020',
      value: 'RIDER-2073083717',
    });
    expect(attributes(result)).toContain('StudyDate');
    expect(attributes(result)).toContain('PrivateTags');
    // Emptied by the archive's de-identification.
    expect(attributes(result)).not.toContain('PatientBirthDate');
    expect(attributes(result)).not.toContain('AccessionNumber');
    expect(attributes(result)).not.toContain('ReferringPhysicianName');
  });

  it('asks for more bytes when the prefix stops inside the header', () => {
    const entry = manifest[0];
    if (!entry) throw new Error('fixture manifest is empty');
    const bytes = new Uint8Array(readFileSync(`${FIXTURES}${entry.file}`));

    for (const length of [64, 140, 700, 1500, entry.headerBytes - 13]) {
      expect(
        parseDicomHeader(bytes.subarray(0, length), { totalSize: entry.originalBytes }),
      ).toEqual({ kind: 'truncated' });
    }
  });
});

describe('parseDicomHeader on what is not a readable DICOM file', () => {
  it('goes by content, not by what the uploader calls the file', () => {
    const png = new Uint8Array(400);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(hasDicomMarker(png)).toBe(false);
    expect(parseWhole(png)).toEqual({ kind: 'not-dicom' });
    expect(parseWhole(new Uint8Array(10))).toEqual({ kind: 'not-dicom' });
    expect(hasDicomMarker(ctSlice())).toBe(true);
  });

  it('reports a marked file whose header runs off the end as unreadable', () => {
    const whole = ctSlice();
    // Complete as far as the caller knows, but cut inside an element.
    const broken = whole.subarray(0, whole.length - 60);
    const result = parseDicomHeader(broken, { totalSize: broken.length });
    expect(result.kind).toBe('unreadable');
    // A readable reason, not "[object Object]": the library throws objects.
    expect(result).toMatchObject({ reason: expect.stringMatching(/^dicomParser\b/) });
  });

  it('reports a marker followed by something that is not a header as unreadable', () => {
    const fake = new Uint8Array(400);
    fake.set([0x44, 0x49, 0x43, 0x4d], 128);
    for (let i = 132; i < fake.length; i += 1) fake.set([(i * 37) % 251], i);
    expect(parseWhole(fake).kind).toBe('unreadable');
  });

  it('does not need the pixel data to be intact', () => {
    const whole = ctSlice();
    const cut = whole.subarray(0, whole.length - 5);
    expect(ok(parseDicomHeader(cut, { totalSize: cut.length })).header.hasPixelData).toBe(true);
  });
});

describe('parseDicomHeader object kinds', () => {
  it('reads an implicit VR little endian file', () => {
    const { header, objectKind } = ok(parseWhole(ctSlice([], IMPLICIT_VR_LITTLE_ENDIAN)));
    expect(header.transferSyntaxUid).toBe(IMPLICIT_VR_LITTLE_ENDIAN);
    expect(header.modality).toBe('CT');
    expect(header.rows).toBe(4);
    expect(header.imagePositionPatient).toEqual([-100, -100, 0]);
    expect(objectKind).toBe('single-frame-image');
  });

  it('separates multi-frame images from single-frame ones', () => {
    const result = ok(parseWhole(ctSlice([{ tag: '00280008', vr: 'IS', value: '12' }])));
    expect(result.header.numberOfFrames).toBe(12);
    expect(result.objectKind).toBe('multi-frame-image');
  });

  it('classes a complete object without pixel data as other', () => {
    const report: TestElement[] = [
      { tag: '00080016', vr: 'UI', value: '1.2.840.10008.5.1.4.1.1.88.11' },
      { tag: '00080018', vr: 'UI', value: '1.2.826.0.1.3680043.8.498.9' },
      { tag: '00080060', vr: 'CS', value: 'SR' },
      { tag: '0020000e', vr: 'UI', value: '1.2.826.0.1.3680043.8.498.300' },
    ];
    const result = ok(parseWhole(buildPart10(report)));
    expect(result.header.hasPixelData).toBe(false);
    expect(result.header.rows).toBeNull();
    expect(result.objectKind).toBe('other');
  });

  it('returns null, not a guess, for geometry that is malformed', () => {
    const { header } = ok(
      parseWhole(
        ctSlice([
          { tag: '00200032', vr: 'DS', value: '1\\2' },
          { tag: '00280030', vr: 'DS', value: 'abc\\0.5' },
        ]),
      ),
    );
    expect(header.imagePositionPatient).toBeNull();
    expect(header.pixelSpacing).toBeNull();
  });
});

describe('de-identification findings (all values invented)', () => {
  it('finds nothing in a clean file', () => {
    expect(ok(parseWhole(ctSlice())).findings).toEqual([]);
  });

  it('reports each populated identifying attribute with its value', () => {
    const result = parseWhole(
      ctSlice([
        { tag: '00080050', vr: 'SH', value: 'ACC-TEST-1' },
        { tag: '00080080', vr: 'LO', value: 'Test General Hospital' },
        { tag: '00080090', vr: 'PN', value: 'Example^Referrer' },
        { tag: '00100010', vr: 'PN', value: 'Example^Patient' },
        { tag: '00100020', vr: 'LO', value: 'MRN-TEST-0001' },
        { tag: '00100030', vr: 'DA', value: '19700101' },
      ]),
    );
    expect(attributes(result)).toEqual([
      'AccessionNumber',
      'InstitutionName',
      'PatientBirthDate',
      'PatientID',
      'PatientName',
      'ReferringPhysicianName',
    ]);
    expect(ok(result).findings).toContainEqual({
      attribute: 'PatientName',
      tag: '00100010',
      value: 'Example^Patient',
    });
  });

  it('does not report an attribute that is present but empty', () => {
    const result = parseWhole(
      ctSlice([
        { tag: '00100010', vr: 'PN', value: '' },
        { tag: '00100030', vr: 'DA', value: '' },
      ]),
    );
    expect(ok(result).findings).toEqual([]);
  });

  it('looks inside sequences', () => {
    const result = parseWhole(
      ctSlice([
        {
          tag: '00081115',
          vr: 'SQ',
          value: [[{ tag: '00100010', vr: 'PN', value: 'Nested^Patient' }]],
        },
      ]),
    );
    expect(ok(result).findings).toEqual([
      { attribute: 'PatientName', tag: '00100010', value: 'Nested^Patient' },
    ]);
  });

  it('reports burned-in annotation and private groups', () => {
    const result = parseWhole(
      ctSlice([
        { tag: '00090010', vr: 'LO', value: 'TEST VENDOR' },
        { tag: '00280301', vr: 'CS', value: 'YES' },
      ]),
    );
    expect(ok(result).findings).toEqual([
      { attribute: 'BurnedInAnnotation', tag: '00280301', value: 'YES' },
      { attribute: 'PrivateTags', tag: null, value: '0009' },
    ]);
  });

  it('finds the same attributes in an implicit VR file', () => {
    const result = parseWhole(
      ctSlice([{ tag: '00100010', vr: 'PN', value: 'Example^Patient' }], IMPLICIT_VR_LITTLE_ENDIAN),
    );
    expect(attributes(result)).toEqual(['PatientName']);
  });
});
