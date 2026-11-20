import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDicomHeader } from './parse-header.js';
import { groupIntoSeries, orderInstances } from './series.js';
import type { DicomInstanceHeader } from './types.js';

const AXIAL: DicomInstanceHeader['imageOrientationPatient'] = [1, 0, 0, 0, 1, 0];

function slice(overrides: Partial<DicomInstanceHeader>): DicomInstanceHeader {
  return {
    sopClassUid: '1.2.840.10008.5.1.4.1.1.2',
    sopInstanceUid: null,
    studyInstanceUid: 'study-1',
    seriesInstanceUid: 'series-1',
    frameOfReferenceUid: null,
    transferSyntaxUid: '1.2.840.10008.1.2.1',
    modality: 'CT',
    seriesNumber: 1,
    instanceNumber: null,
    imagePositionPatient: null,
    imageOrientationPatient: AXIAL,
    rows: 512,
    columns: 512,
    numberOfFrames: null,
    bitsAllocated: 16,
    pixelRepresentation: 1,
    photometricInterpretation: 'MONOCHROME2',
    sliceThickness: 5,
    pixelSpacing: [0.5, 0.5],
    windowCenter: 40,
    windowWidth: 80,
    hasPixelData: true,
    ...overrides,
  };
}

const numbers = (instances: DicomInstanceHeader[]) => instances.map((i) => i.instanceNumber);
const uids = (instances: DicomInstanceHeader[]) => instances.map((i) => i.sopInstanceUid);

describe('orderInstances', () => {
  it('orders by position when instance numbers are missing', () => {
    const ordered = orderInstances([
      slice({ sopInstanceUid: 'c', imagePositionPatient: [0, 0, 10] }),
      slice({ sopInstanceUid: 'a', imagePositionPatient: [0, 0, 0] }),
      slice({ sopInstanceUid: 'b', imagePositionPatient: [0, 0, 5] }),
    ]);
    expect(uids(ordered)).toEqual(['a', 'b', 'c']);
  });

  it("keeps the scanner's direction when numbers run against the axis", () => {
    // Head-first acquisition: slice 1 is the highest.
    const ordered = orderInstances([
      slice({ instanceNumber: 2, imagePositionPatient: [0, 0, 5] }),
      slice({ instanceNumber: 3, imagePositionPatient: [0, 0, 0] }),
      slice({ instanceNumber: 1, imagePositionPatient: [0, 0, 10] }),
    ]);
    expect(numbers(ordered)).toEqual([1, 2, 3]);
  });

  it('trusts geometry over instance numbers that repeat', () => {
    const ordered = orderInstances([
      slice({ sopInstanceUid: 'top', instanceNumber: 1, imagePositionPatient: [0, 0, 10] }),
      slice({ sopInstanceUid: 'mid', instanceNumber: 1, imagePositionPatient: [0, 0, 5] }),
      slice({ sopInstanceUid: 'low', instanceNumber: 1, imagePositionPatient: [0, 0, 0] }),
    ]);
    expect(uids(ordered)).toEqual(['low', 'mid', 'top']);
  });

  it('uses the slice normal, not the z axis, for an oblique or coronal stack', () => {
    // Coronal: rows run along x, columns along -z; the normal is y.
    const coronal: DicomInstanceHeader['imageOrientationPatient'] = [1, 0, 0, 0, 0, -1];
    const ordered = orderInstances([
      slice({
        sopInstanceUid: 'back',
        imageOrientationPatient: coronal,
        imagePositionPatient: [0, 30, 0],
      }),
      slice({
        sopInstanceUid: 'front',
        imageOrientationPatient: coronal,
        imagePositionPatient: [0, 10, 0],
      }),
      slice({
        sopInstanceUid: 'middle',
        imageOrientationPatient: coronal,
        imagePositionPatient: [0, 20, 0],
      }),
    ]);
    expect(uids(ordered)).toEqual(['front', 'middle', 'back']);
  });

  it('falls back to instance number when any slice has no position', () => {
    const ordered = orderInstances([
      slice({ instanceNumber: 3, imagePositionPatient: [0, 0, 0] }),
      slice({ instanceNumber: 1 }),
      slice({ instanceNumber: 2, imagePositionPatient: [0, 0, 10] }),
    ]);
    expect(numbers(ordered)).toEqual([1, 2, 3]);
  });

  it('is deterministic when nothing distinguishes two slices but their UID', () => {
    const input = [slice({ sopInstanceUid: 'b' }), slice({ sopInstanceUid: 'a' })];
    expect(uids(orderInstances(input))).toEqual(['a', 'b']);
    expect(uids(orderInstances([...input].reverse()))).toEqual(['a', 'b']);
  });

  it('does not reorder its input and accepts an empty series', () => {
    const input = [
      slice({ sopInstanceUid: 'b', imagePositionPatient: [0, 0, 5] }),
      slice({ sopInstanceUid: 'a', imagePositionPatient: [0, 0, 0] }),
    ];
    orderInstances(input);
    expect(uids(input)).toEqual(['b', 'a']);
    expect(orderInstances([])).toEqual([]);
  });

  it('orders real slices whose file names do not follow the anatomy', () => {
    // In the public series the files are named 00000001, 00000025 and
    // 00000049 and carry instance numbers 31, 18 and 19.
    const dir = fileURLToPath(new URL('../fixtures/rider-lung-ct/', import.meta.url));
    const manifest = JSON.parse(readFileSync(`${dir}manifest.json`, 'utf8')) as Array<{
      file: string;
      originalBytes: number;
      transferSyntaxUid: string;
    }>;
    const headers = manifest
      .filter((entry) => entry.transferSyntaxUid === '1.2.840.10008.1.2.1')
      .map((entry) => {
        const result = parseDicomHeader(new Uint8Array(readFileSync(`${dir}${entry.file}`)), {
          totalSize: entry.originalBytes,
        });
        if (result.kind !== 'ok') throw new Error(`${entry.file}: ${result.kind}`);
        return result.header;
      });

    expect(numbers(orderInstances(headers))).toEqual([18, 19, 31]);
  });
});

describe('groupIntoSeries', () => {
  it('groups by series, orders each, and sorts series by study then number', () => {
    const series = groupIntoSeries([
      slice({ seriesInstanceUid: 's-b', seriesNumber: 3, instanceNumber: 2 }),
      slice({ seriesInstanceUid: 's-a', seriesNumber: 2, instanceNumber: 1, modality: 'CT' }),
      slice({ seriesInstanceUid: 's-b', seriesNumber: 3, instanceNumber: 1 }),
      slice({ studyInstanceUid: 'study-0', seriesInstanceUid: 's-z', seriesNumber: 9 }),
    ]);

    expect(series.map((s) => s.seriesInstanceUid)).toEqual(['s-z', 's-a', 's-b']);
    expect(series[2]?.instances.map((i) => i.instanceNumber)).toEqual([1, 2]);
    expect(series[1]).toMatchObject({
      studyInstanceUid: 'study-1',
      modality: 'CT',
      seriesNumber: 2,
    });
  });

  it('leaves out instances that name no series', () => {
    const series = groupIntoSeries([
      slice({ seriesInstanceUid: null }),
      slice({ seriesInstanceUid: 's-a' }),
    ]);
    expect(series).toHaveLength(1);
    expect(series[0]?.instances).toHaveLength(1);
  });
});
