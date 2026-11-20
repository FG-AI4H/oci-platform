import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { IDENTIFYING_ATTRIBUTES } from '@oci/dicom';
import { buildPart10, IMPLICIT_VR_LITTLE_ENDIAN } from '@oci/dicom/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ACCEPTABLE_BY_DECISION,
  AcceptedFindingsSchema,
  attributeListDigest,
  checkSample,
} from './arrival-check.js';
import {
  INVENTED_MARKER,
  slice,
  writeCleanSample,
  writeFile,
} from './test-support/synthetic-sample.js';

let folder: string;

beforeEach(() => {
  folder = realpathSync(mkdtempSync(path.join(tmpdir(), 'oci-arrival-')));
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

const codes = (result: ReturnType<typeof checkSample>): string[] =>
  result.problems.map((problem) => problem.code);

describe('arrival check: a clean sample', () => {
  it('passes, and reports each exam with its series, images, thickness, modality and transfer syntax', () => {
    const written = writeCleanSample(folder, { exams: 2, slicesPerSeries: 3 });
    writeFile(
      folder,
      'exam-001/series-02/0001.dcm',
      slice({ exam: 1, series: 2, instance: 1, thicknessMm: 1.25 }),
    );

    const result = checkSample(folder);

    expect(result.verdict).toBe('PASS');
    expect(result.problems).toEqual([]);
    expect(result.filesRead).toBe(7);
    expect(result.exams).toHaveLength(2);
    const first = result.exams.find((exam) => exam.folders.includes('exam-001'));
    expect(first?.series).toEqual([
      expect.objectContaining({
        number: 1,
        modality: 'CT',
        images: 3,
        sliceThicknessMm: [5],
        dimensions: ['4 x 4'],
        transferSyntaxes: ['1.2.840.10008.1.2.1'],
      }),
      expect.objectContaining({ number: 2, images: 1, sliceThicknessMm: [1.25] }),
    ]);
    expect(result.warnings).toEqual([]);

    // The record lists exactly the files on disk, by checksum.
    expect(result.files.map((file) => file.path)).toEqual(
      [...written, 'exam-001/series-02/0001.dcm'].sort(),
    );
    const one = result.files.find((file) => file.path === written[0]);
    const bytes = readFileSync(path.join(folder, written[0] ?? ''));
    expect(one?.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(one?.sizeBytes).toBe(bytes.length);
  });

  it('refers to exams and series by a digest, never by their UID', () => {
    writeCleanSample(folder, { exams: 1 });
    const text = JSON.stringify(checkSample(folder));
    expect(text).not.toContain('1.2.826.0.1.3680043.8.498.658');
  });
});

describe("arrival check: the platform's identifying attributes", () => {
  it.each(IDENTIFYING_ATTRIBUTES.map((entry) => [entry.attribute, entry.tag] as const))(
    'refuses a sample in which %s is populated, and names the attribute and the file',
    (attribute, tag) => {
      writeCleanSample(folder, { exams: 1 });
      writeFile(
        folder,
        'exam-002/series-01/0001.dcm',
        slice({
          exam: 2,
          series: 1,
          instance: 1,
          overrides: [{ tag, vr: 'LO', value: `${INVENTED_MARKER}-${attribute}` }],
        }),
      );

      const result = checkSample(folder);

      expect(result.verdict).toBe('REFUSED');
      expect(result.problems).toEqual([
        {
          code: `finding:${attribute}`,
          summary: `the identifying attribute ${attribute} is populated`,
          files: ['exam-002/series-01/0001.dcm'],
        },
      ]);
      // Not the value: nowhere in what the check returns.
      expect(JSON.stringify(result)).not.toContain(INVENTED_MARKER);
    },
  );

  it('refuses an attribute populated inside a sequence', () => {
    writeFile(
      folder,
      'exam-001/series-01/0001.dcm',
      slice({
        exam: 1,
        series: 1,
        instance: 1,
        overrides: [
          {
            tag: '00081115',
            vr: 'SQ',
            value: [[{ tag: '00100020', vr: 'LO', value: `${INVENTED_MARKER}-nested` }]],
          },
        ],
      }),
    );
    const result = checkSample(folder);
    expect(codes(result)).toEqual(['finding:PatientID']);
    expect(JSON.stringify(result)).not.toContain(INVENTED_MARKER);
  });

  it('refuses private tags, a declared burned-in annotation and data after the pixel data', () => {
    writeFile(
      folder,
      'exam-001/series-01/0001.dcm',
      slice({
        exam: 1,
        series: 1,
        instance: 1,
        overrides: [{ tag: '00090010', vr: 'LO', value: `${INVENTED_MARKER}-private` }],
      }),
    );
    writeFile(
      folder,
      'exam-001/series-01/0002.dcm',
      slice({
        exam: 1,
        series: 1,
        instance: 2,
        overrides: [{ tag: '00280301', vr: 'CS', value: 'YES' }],
      }),
    );
    const trailing = slice({ exam: 1, series: 1, instance: 3 });
    const withTail = new Uint8Array(trailing.length + 16);
    withTail.set(trailing);
    withTail.set(new TextEncoder().encode(INVENTED_MARKER), trailing.length);
    writeFile(folder, 'exam-001/series-01/0003.dcm', withTail);

    const result = checkSample(folder);

    expect(result.verdict).toBe('REFUSED');
    expect(codes(result).sort()).toEqual([
      'finding:BurnedInAnnotation',
      'finding:DataAfterPixelData',
      'finding:PrivateTags',
    ]);
    expect(JSON.stringify(result)).not.toContain(INVENTED_MARKER);
  });

  it('counts the files and the distinct values of a finding, without keeping a value', () => {
    for (let instance = 1; instance <= 3; instance += 1) {
      writeFile(
        folder,
        `exam-001/series-01/000${instance}.dcm`,
        slice({
          exam: 1,
          series: 1,
          instance,
          overrides: [
            {
              tag: '00100020',
              vr: 'LO',
              value: `${INVENTED_MARKER}-${instance === 3 ? 'B' : 'A'}`,
            },
          ],
        }),
      );
    }
    const decisions = AcceptedFindingsSchema.parse({
      decidedBy: 'An Operator',
      decidedOn: '2026-12-01',
      institutionStatement: 'letter ref. EX-1',
      attributes: [{ attribute: 'PatientID', reason: 'study codes made for this sample' }],
    });

    const result = checkSample(folder, { accepted: decisions });

    expect(result.verdict).toBe('PASS');
    expect(result.accepted).toEqual([
      {
        attribute: 'PatientID',
        reason: 'study codes made for this sample',
        files: 3,
        distinctValues: 2,
      },
    ]);
    expect(result.files.every((file) => file.acceptedFindings.includes('PatientID'))).toBe(true);
    expect(JSON.stringify(result)).not.toContain(INVENTED_MARKER);
  });
});

describe('arrival check: a recorded decision', () => {
  it('accepts only the attribute it names', () => {
    writeFile(
      folder,
      'exam-001/series-01/0001.dcm',
      slice({
        exam: 1,
        series: 1,
        instance: 1,
        overrides: [
          { tag: '00100010', vr: 'PN', value: `${INVENTED_MARKER}^NAME` },
          { tag: '00100020', vr: 'LO', value: `${INVENTED_MARKER}-ID` },
        ],
      }),
    );
    const decisions = AcceptedFindingsSchema.parse({
      decidedBy: 'An Operator',
      decidedOn: '2026-12-01',
      institutionStatement: 'letter ref. EX-1',
      attributes: [{ attribute: 'PatientID', reason: 'study codes' }],
    });
    expect(codes(checkSample(folder, { accepted: decisions }))).toEqual(['finding:PatientName']);
  });

  it('can only name attributes that de-identified files are known to keep, all of them on the platform list', () => {
    const platform = new Set(IDENTIFYING_ATTRIBUTES.map((entry) => entry.attribute));
    for (const attribute of ACCEPTABLE_BY_DECISION) expect(platform.has(attribute)).toBe(true);

    const decision = (attribute: string) =>
      AcceptedFindingsSchema.safeParse({
        decidedBy: 'An Operator',
        decidedOn: '2026-12-01',
        institutionStatement: 'letter ref. EX-1',
        attributes: [{ attribute, reason: 'because' }],
      }).success;
    expect(decision('PatientID')).toBe(true);
    for (const refused of [
      'PatientBirthDate',
      'InstitutionName',
      'PrivateTags',
      'BurnedInAnnotation',
    ]) {
      expect(decision(refused)).toBe(false);
    }
  });

  it('needs a name, a date, a reference and a reason', () => {
    const base = {
      decidedBy: 'An Operator',
      decidedOn: '2026-12-01',
      institutionStatement: 'letter ref. EX-1',
      attributes: [{ attribute: 'PatientID', reason: 'study codes' }],
    };
    expect(AcceptedFindingsSchema.safeParse(base).success).toBe(true);
    expect(AcceptedFindingsSchema.safeParse({ ...base, decidedBy: ' ' }).success).toBe(false);
    expect(AcceptedFindingsSchema.safeParse({ ...base, decidedOn: '1 Dec' }).success).toBe(false);
    expect(AcceptedFindingsSchema.safeParse({ ...base, institutionStatement: '' }).success).toBe(
      false,
    );
    expect(
      AcceptedFindingsSchema.safeParse({
        ...base,
        attributes: [{ attribute: 'PatientID', reason: '' }],
      }).success,
    ).toBe(false);
    expect(AcceptedFindingsSchema.safeParse({ ...base, attributes: [] }).success).toBe(false);
  });
});

describe('arrival check: names', () => {
  it('refuses a file name that could be an identifier, and does not repeat it', () => {
    writeCleanSample(folder, { exams: 1 });
    writeFile(
      folder,
      'exam-002/QUILLFEATHER_ZORBLAX_19990101.dcm',
      slice({ exam: 2, series: 1, instance: 1 }),
    );
    const result = checkSample(folder);
    expect(result.verdict).toBe('REFUSED');
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]?.code).toMatch(/^name:/);
    expect(result.problems[0]?.files).toEqual(['exam-002/[name withheld: entry 1 of 1]']);
    expect(JSON.stringify(result)).not.toMatch(/QUILLFEATHER|ZORBLAX|19990101/);
  });

  it('refuses a folder name that could be an identifier, once, whatever the number of files in it', () => {
    for (let instance = 1; instance <= 3; instance += 1) {
      writeFile(
        folder,
        `Zorblax Quillfeather/series-01/000${instance}.dcm`,
        slice({ exam: 1, series: 1, instance }),
      );
    }
    const result = checkSample(folder);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]?.files).toEqual(['[name withheld: entry 1 of 1]']);
    expect(JSON.stringify(result)).not.toMatch(/Zorblax|Quillfeather/);
  });
});

describe('arrival check: what is not a DICOM image', () => {
  it('refuses a file that is not DICOM, such as a spreadsheet left in the folder', () => {
    writeCleanSample(folder, { exams: 1 });
    writeFile(folder, 'exam-001/data.csv', `exam,patient\n1,${INVENTED_MARKER}\n`);
    const result = checkSample(folder);
    expect(result.verdict).toBe('REFUSED');
    expect(codes(result)).toContain('not-dicom');
    expect(JSON.stringify(result)).not.toContain(INVENTED_MARKER);
  });

  it('refuses a file marked as DICOM whose header cannot be read', () => {
    const bytes = new Uint8Array(400);
    bytes.set(new TextEncoder().encode('DICM'), 128);
    bytes.fill(0xff, 132);
    writeFile(folder, 'exam-001/series-01/0001.dcm', bytes);
    expect(codes(checkSample(folder))).toContain('unreadable');
  });

  it('refuses a DICOM object that is not an image', () => {
    writeFile(
      folder,
      'exam-001/series-01/0001.dcm',
      buildPart10([
        { tag: '00080016', vr: 'UI', value: '1.2.840.10008.5.1.4.1.1.88.11' },
        { tag: '00080018', vr: 'UI', value: '1.2.826.0.1.3680043.8.498.658.9.1' },
        { tag: '00080060', vr: 'CS', value: 'SR' },
        { tag: '0020000d', vr: 'UI', value: '1.2.826.0.1.3680043.8.498.658.9' },
        { tag: '0020000e', vr: 'UI', value: '1.2.826.0.1.3680043.8.498.658.9.2' },
      ]),
    );
    expect(codes(checkSample(folder))).toEqual(['not-an-image', 'no-images']);
  });

  it('does not follow a symbolic link, and refuses the sample that holds one', () => {
    writeCleanSample(folder, { exams: 1 });
    const outside = realpathSync(mkdtempSync(path.join(tmpdir(), 'oci-arrival-outside-')));
    try {
      writeFile(outside, 'elsewhere.dcm', slice({ exam: 9, series: 1, instance: 1 }));
      symlinkSync(
        path.join(outside, 'elsewhere.dcm'),
        path.join(folder, 'exam-001', 'image-9999.dcm'),
      );
      const result = checkSample(folder);
      expect(codes(result)).toEqual(['not-a-regular-file']);
      expect(result.files).toHaveLength(3);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('refuses an empty folder', () => {
    expect(codes(checkSample(folder))).toEqual(['no-images']);
  });
});

describe('arrival check: what is worth knowing before the room', () => {
  it('says when a transfer syntax has not been tried in the viewer', () => {
    writeFile(
      folder,
      'exam-001/series-01/0001.dcm',
      slice({ exam: 1, series: 1, instance: 1, transferSyntaxUid: IMPLICIT_VR_LITTLE_ENDIAN }),
    );
    const result = checkSample(folder);
    expect(result.verdict).toBe('PASS');
    expect(result.warnings.join('\n')).toMatch(
      /Implicit VR Little Endian \(1\.2\.840\.10008\.1\.2\)/,
    );
  });

  it('says when a series has a gap, several thicknesses, or a multi-frame object', () => {
    for (const [instance, z] of [
      [1, 0],
      [2, 5],
      [3, 10],
      [4, 25],
    ] as const) {
      writeFile(
        folder,
        `exam-001/series-01/000${instance}.dcm`,
        slice({ exam: 1, series: 1, instance, z }),
      );
    }
    writeFile(folder, 'exam-001/series-02/0001.dcm', slice({ exam: 1, series: 2, instance: 1 }));
    writeFile(
      folder,
      'exam-001/series-02/0002.dcm',
      slice({ exam: 1, series: 2, instance: 2, thicknessMm: 1 }),
    );
    writeFile(
      folder,
      'exam-001/series-03/0001.dcm',
      slice({
        exam: 1,
        series: 3,
        instance: 1,
        overrides: [{ tag: '00280008', vr: 'IS', value: '12' }],
      }),
    );

    const result = checkSample(folder);

    expect(result.verdict).toBe('PASS');
    const warnings = result.warnings.join('\n');
    expect(warnings).toMatch(/series 1: the slices are not evenly spaced/);
    expect(warnings).toMatch(/series 2: several slice thicknesses in one series \(1, 5 mm\)/);
    expect(warnings).toMatch(/series 3: 1 multi-frame object/);
  });

  it('points the visual check at secondary captures and at series that are not CT', () => {
    writeFile(
      folder,
      'exam-001/series-09/0001.dcm',
      slice({
        exam: 1,
        series: 9,
        instance: 1,
        overrides: [
          { tag: '00080016', vr: 'UI', value: '1.2.840.10008.5.1.4.1.1.7' },
          { tag: '00080060', vr: 'CS', value: 'OT' },
        ],
      }),
    );
    const [exam] = checkSample(folder).exams;
    expect(exam?.series[0]?.secondaryCapture).toBe(true);
    expect(exam?.lookClosely.join('\n')).toMatch(/series 9 is a secondary capture/);
    expect(exam?.lookClosely.join('\n')).toMatch(/series 9 has modality OT, not CT/);
  });

  it('says when two files are the same image', () => {
    const bytes = slice({ exam: 1, series: 1, instance: 1 });
    writeFile(folder, 'exam-001/series-01/0001.dcm', bytes);
    writeFile(folder, 'exam-001/series-01/0002.dcm', bytes);
    expect(checkSample(folder).warnings.join('\n')).toMatch(/same instance UID/);
  });
});

describe('arrival check: the attribute list', () => {
  it("is the platform's, identified by a digest that changes with it", () => {
    expect(attributeListDigest()).toMatch(/^[0-9a-f]{64}$/);
    expect(attributeListDigest()).toBe(
      createHash('sha256').update(JSON.stringify(IDENTIFYING_ATTRIBUTES)).digest('hex'),
    );
  });
});
