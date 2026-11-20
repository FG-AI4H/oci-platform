import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DATA_AFTER_PIXEL_DATA, MAX_SEQUENCE_DEPTH, SEQUENCE_DEPTH_EXCEEDED } from './findings.js';
import { endsWithSequenceDelimiter, parseDicomHeader } from './parse-header.js';
import { orderInstances } from './series.js';
import {
  EXPLICIT_VR_LITTLE_ENDIAN,
  IMPLICIT_VR_LITTLE_ENDIAN,
  buildPart10,
  ctSlice,
  type TestElement,
} from './test-support/build-part10.js';
import type { DicomInstanceHeader, ParseDicomHeaderResult } from './types.js';

/**
 * This package is the de-identification check. Each test here is a way
 * a file could have slipped through as clean, or crashed the caller,
 * and pins the behaviour that stops it. All patient values are invented.
 */

function ok(result: ParseDicomHeaderResult) {
  if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.kind}`);
  return result;
}
const whole = (bytes: Uint8Array) => parseDicomHeader(bytes, { totalSize: bytes.length });
const attributes = (result: ParseDicomHeaderResult) => ok(result).findings.map((f) => f.attribute);

const NAMED: TestElement = { tag: '00100010', vr: 'PN', value: 'Example^Patient' };

describe('parseDicomHeader never throws', () => {
  it.each([
    ['explicit VR', EXPLICIT_VR_LITTLE_ENDIAN],
    ['implicit VR', IMPLICIT_VR_LITTLE_ENDIAN],
  ])('at any cut point of an %s file, as a prefix or as a whole file', (_name, syntax) => {
    const file = ctSlice([NAMED], syntax);
    const kinds = new Set<string>();
    for (let cut = 0; cut < file.length; cut += 1) {
      const prefix = file.subarray(0, cut);
      // As a prefix of a longer file: more bytes can always be asked for.
      const asPrefix = parseDicomHeader(prefix, { totalSize: file.length });
      if (asPrefix.kind !== 'ok') expect(asPrefix.kind).toBe('truncated');
      // As a complete, damaged file: never `truncated`, there is nothing more to read.
      const asWhole = parseDicomHeader(prefix, { totalSize: cut });
      expect(asWhole.kind).not.toBe('truncated');
      kinds.add(asWhole.kind);
    }
    expect(kinds).toContain('unreadable');
  });

  it('on a Node Buffer as well as on a Uint8Array', () => {
    const file = ctSlice([NAMED]);
    expect(attributes(whole(Buffer.from(file)))).toEqual(['PatientName']);
  });
});

describe('a header that cannot be read is bounded and never passes as clean', () => {
  it('stops asking for more bytes at the limit', () => {
    const fake = new Uint8Array(2048);
    fake.set([0x44, 0x49, 0x43, 0x4d], 128);
    const fiveGigabytes = 5 * 1024 ** 3;

    expect(
      parseDicomHeader(fake.subarray(0, 400), { totalSize: fiveGigabytes, maxHeaderBytes: 1024 }),
    ).toEqual({ kind: 'truncated' });
    expect(
      parseDicomHeader(fake.subarray(0, 1024), { totalSize: fiveGigabytes, maxHeaderBytes: 1024 })
        .kind,
    ).toBe('unreadable');
  });

  it('gives up on an object with no pixel data inside the limit', () => {
    const report = buildPart10([
      { tag: '00080016', vr: 'UI', value: '1.2.840.10008.5.1.4.1.1.88.11' },
      { tag: '00080060', vr: 'CS', value: 'SR' },
    ]);
    const result = parseDicomHeader(report, {
      totalSize: 50_000_000,
      maxHeaderBytes: report.length,
    });
    expect(result).toEqual({
      kind: 'unreadable',
      reason: `no pixel data within the first ${report.length} bytes`,
    });
  });

  it.each([
    ['a Uint8Array', (bytes: Uint8Array) => bytes],
    ['a Buffer', (bytes: Uint8Array) => Buffer.from(bytes)],
  ])('refuses the deflated transfer syntax without inflating it, given %s', (_name, wrap) => {
    const deflated = ctSlice([NAMED], '1.2.840.10008.1.2.1.99');
    expect(whole(wrap(deflated))).toEqual({
      kind: 'unreadable',
      reason: 'the deflated transfer syntax is not supported',
    });
  });
});

describe('content the check does not reach is reported, not ignored', () => {
  it('flags uncompressed pixel data that is followed by more elements', () => {
    // Out of tag order on purpose: the name sits after the pixel data.
    const file = buildPart10([
      { tag: '00080060', vr: 'CS', value: 'CT' },
      { tag: '00280010', vr: 'US', value: 4 },
      { tag: '00280011', vr: 'US', value: 4 },
      { tag: '7fe00010', vr: 'OW', value: new Uint8Array(32) },
      { tag: '00100010', vr: 'PN', value: 'After^Pixels' },
    ]);
    expect(ok(whole(file)).findings).toEqual([DATA_AFTER_PIXEL_DATA]);
    // The same answer from a header-only prefix, which is what the API reads.
    const headerOnly = file.subarray(0, ok(whole(file)).pixelData?.offset);
    expect(ok(parseDicomHeader(headerOnly, { totalSize: file.length })).findings).toEqual([
      DATA_AFTER_PIXEL_DATA,
    ]);
  });

  it('does not flag a file that ends with its pixel data', () => {
    const result = ok(whole(ctSlice()));
    expect(result.findings).toEqual([]);
    expect(result.pixelData).toEqual({ offset: ctSlice().length - 32, length: 32 });
  });

  it('leaves the end-of-file check of compressed pixel data to the caller, with what it needs', () => {
    const dir = fileURLToPath(new URL('../fixtures/rider-lung-ct/', import.meta.url));
    const manifest = JSON.parse(readFileSync(`${dir}manifest.json`, 'utf8')) as Array<{
      file: string;
      headerBytes: number;
      originalBytes: number;
    }>;
    for (const entry of manifest) {
      const bytes = new Uint8Array(readFileSync(`${dir}${entry.file}`));
      const result = ok(parseDicomHeader(bytes, { totalSize: entry.originalBytes }));
      const compressed = !entry.file.startsWith('explicit-le');
      expect(result.pixelData?.offset).toBe(entry.headerBytes);
      expect(result.pixelData?.length === null).toBe(compressed);
      // Real files end with their pixel data: no structural finding.
      expect(result.findings.map((f) => f.attribute)).not.toContain('DataAfterPixelData');
    }

    const delimiter = new Uint8Array([0xfe, 0xff, 0xdd, 0xe0, 0, 0, 0, 0]);
    expect(endsWithSequenceDelimiter(delimiter)).toBe(true);
    expect(endsWithSequenceDelimiter(new Uint8Array([1, 2, 3, ...delimiter]))).toBe(true);
    expect(endsWithSequenceDelimiter(new Uint8Array([...delimiter, 0x10, 0x00]))).toBe(false);
    expect(endsWithSequenceDelimiter(new Uint8Array(4))).toBe(false);
  });

  it('says so when sequences nest deeper than it looks', () => {
    const nest = (depth: number): TestElement =>
      depth === 0
        ? { tag: '00100010', vr: 'PN', value: 'Deep^Patient' }
        : { tag: '00081115', vr: 'SQ', value: [[nest(depth - 1)]] };

    const atLimit = whole(ctSlice([nest(MAX_SEQUENCE_DEPTH)]));
    expect(attributes(atLimit)).toEqual(['PatientName']);

    const beyond = whole(ctSlice([nest(MAX_SEQUENCE_DEPTH + 1)]));
    expect(ok(beyond).findings).toEqual([SEQUENCE_DEPTH_EXCEEDED]);
  });
});

describe('values are read the way other software shows them', () => {
  it('finds a name that starts with a NUL byte', () => {
    const value = new Uint8Array([0x00, ...new TextEncoder().encode('Hidden^Name ')]);
    // Written as bytes: the builder's text path would not produce a leading NUL.
    const file = ctSlice([{ tag: '00100010', vr: 'OB', value }]);
    expect(ok(whole(file)).findings).toEqual([
      { attribute: 'PatientName', tag: '00100010', value: 'Hidden^Name' },
    ]);
  });

  it('treats a value of only NUL bytes and spaces as empty', () => {
    const file = ctSlice([
      { tag: '00100010', vr: 'OB', value: new Uint8Array([0, 0x20, 0, 0x20]) },
    ]);
    expect(ok(whole(file)).findings).toEqual([]);
  });

  it('decodes UTF-8 and Latin-1 names legibly for the operator', () => {
    const utf8 = ctSlice([{ tag: '00100010', vr: 'PN', value: 'Müller^Zoë' }]);
    expect(ok(whole(utf8)).findings[0]?.value).toBe('Müller^Zoë');

    const latin1 = ctSlice([
      { tag: '00100010', vr: 'OB', value: new Uint8Array([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72]) },
    ]);
    expect(ok(whole(latin1)).findings[0]?.value).toBe('Müller');
  });
});

describe('numbers are whole values or nothing', () => {
  it.each([
    ['00200032', '1\\2\\3abc', 'imagePositionPatient'],
    ['00280030', '0.5mm\\0.5', 'pixelSpacing'],
    ['00200013', '7x', 'instanceNumber'],
    ['00180050', '5 mm', 'sliceThickness'],
  ] as const)('%s = "%s" gives a null %s', (tag, value, field) => {
    const vr = tag === '00200013' ? 'IS' : 'DS';
    const { header } = ok(whole(ctSlice([{ tag, vr, value }])));
    expect(header).toMatchObject({ [field]: null });
  });

  it('still reads signed, padded and exponent forms', () => {
    const { header } = ok(
      whole(
        ctSlice([
          { tag: '00180050', vr: 'DS', value: ' 1.25e0 ' },
          { tag: '00200013', vr: 'IS', value: '+12' },
          { tag: '00200032', vr: 'DS', value: '-133.699997\\ -133\\.5' },
        ]),
      ),
    );
    expect(header.sliceThickness).toBe(1.25);
    expect(header.instanceNumber).toBe(12);
    expect(header.imagePositionPatient).toEqual([-133.699997, -133, 0.5]);
  });

  it('does not call an image with no rows or no frames a displayable slice', () => {
    expect(ok(whole(ctSlice([{ tag: '00280010', vr: 'US', value: 0 }]))).objectKind).toBe('other');
    expect(ok(whole(ctSlice([{ tag: '00280008', vr: 'IS', value: '0' }]))).objectKind).toBe(
      'other',
    );
  });
});

describe('orderInstances on series that are not a simple stack', () => {
  const AXIAL: DicomInstanceHeader['imageOrientationPatient'] = [1, 0, 0, 0, 1, 0];
  const CORONAL: DicomInstanceHeader['imageOrientationPatient'] = [1, 0, 0, 0, 0, -1];
  const at = (
    uid: string,
    instanceNumber: number | null,
    z: number,
    orientation: DicomInstanceHeader['imageOrientationPatient'] = AXIAL,
  ) => ({
    sopInstanceUid: uid,
    instanceNumber,
    imagePositionPatient: [0, 0, z] as [number, number, number],
    imageOrientationPatient: orientation,
  });
  const order = (instances: ReturnType<typeof at>[]) =>
    orderInstances(instances).map((i) => i.sopInstanceUid);

  it('keeps the scanner direction in a two-phase series with repeated positions', () => {
    // Phase one is numbered 1..3 and phase two 4..6, both from the top down.
    const series = [
      at('p1-top', 1, 10),
      at('p1-mid', 2, 5),
      at('p1-low', 3, 0),
      at('p2-top', 4, 10),
      at('p2-mid', 5, 5),
      at('p2-low', 6, 0),
    ];
    expect(order(series)).toEqual(['p1-top', 'p2-top', 'p1-mid', 'p2-mid', 'p1-low', 'p2-low']);
  });

  it('is not flipped by one slice that has no instance number', () => {
    expect(order([at('a', 1, 10), at('b', 2, 5), at('c', null, 0)])).toEqual(['a', 'b', 'c']);
  });

  it('breaks ties at one position by number then UID, whatever the direction', () => {
    const series = [at('b', 1, 10), at('a', 1, 10), at('c', 2, 5), at('d', 3, 0)];
    expect(order(series)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('falls back to instance numbers for a three-plane localiser, in any input order', () => {
    const series = [at('ax', 2, 0), at('co', 1, 0, CORONAL), at('ax2', 3, 5)];
    const expected = ['co', 'ax', 'ax2'];
    expect(order(series)).toEqual(expected);
    expect(order([...series].reverse())).toEqual(expected);
    expect(order([series[1], series[2], series[0]] as typeof series)).toEqual(expected);
  });

  it('gives the same stack whatever order the slices arrive in', () => {
    const series = [at('a', 1, 10), at('b', 2, 5), at('c', 3, 0), at('d', 4, -5)];
    const expected = order(series);
    expect(order([...series].reverse())).toEqual(expected);
    expect(order([series[2], series[0], series[3], series[1]] as typeof series)).toEqual(expected);
  });

  it('accepts orientations that differ only by rounding', () => {
    const rounded: DicomInstanceHeader['imageOrientationPatient'] = [
      0.9999996, 0, 0, 0, 1, 0.0000004,
    ];
    expect(order([at('a', null, 10), at('b', null, 0, rounded)])).toEqual(['b', 'a']);
  });
});
