import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseDicomHeader } from '@oci/dicom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkSample } from './arrival-check.js';
import { SYNTHETIC_FINDING_VALUE, writeSyntheticExams } from './synthetic-exam.js';

let folder: string;
beforeEach(() => {
  folder = realpathSync(mkdtempSync(path.join(tmpdir(), 'oci-synthetic-')));
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe('writeSyntheticExams', () => {
  it('writes exams that pass the arrival check as evenly spaced CT series', () => {
    expect(writeSyntheticExams(folder, { exams: 2, slices: 6, findingInExam: 0 })).toBe(12);
    const result = checkSample(folder);
    expect(result.verdict).toBe('PASS');
    expect(result.warnings).toEqual([]);
    expect(result.exams.map((exam) => exam.folders)).toEqual([['exam-001'], ['exam-002']]);
    expect(result.exams[0]?.series[0]).toMatchObject({
      modality: 'CT',
      images: 6,
      dimensions: ['256 x 256'],
      sliceThicknessMm: [5],
    });
  });

  it('writes a complete single-frame image: 16-bit pixel data of the declared size', () => {
    writeSyntheticExams(folder, { exams: 1, slices: 1, findingInExam: 0 });
    const bytes = new Uint8Array(readFileSync(path.join(folder, 'exam-001/series-01/0001.dcm')));
    const parsed = parseDicomHeader(bytes, { totalSize: bytes.length });
    if (parsed.kind !== 'ok') throw new Error(`not parsed: ${parsed.kind}`);
    expect(parsed.objectKind).toBe('single-frame-image');
    expect(parsed.findings).toEqual([]);
    expect(parsed.pixelData?.length).toBe(256 * 256 * 2);
  });

  it('can fill PatientID in one exam, so that the check is seen refusing', () => {
    writeSyntheticExams(folder, { exams: 2, slices: 2, findingInExam: 2 });
    const result = checkSample(folder);
    expect(result.verdict).toBe('REFUSED');
    expect(result.problems).toEqual([
      {
        code: 'finding:PatientID',
        summary: 'the identifying attribute PatientID is populated',
        files: ['exam-002/series-01/0001.dcm', 'exam-002/series-01/0002.dcm'],
      },
    ]);
    expect(JSON.stringify(result)).not.toContain(SYNTHETIC_FINDING_VALUE);
  });

  it('refuses a folder that is not empty', () => {
    writeSyntheticExams(folder, { exams: 1, slices: 1, findingInExam: 0 });
    expect(() => writeSyntheticExams(folder, { exams: 1, slices: 1, findingInExam: 0 })).toThrow(
      /is not empty/,
    );
  });
});
