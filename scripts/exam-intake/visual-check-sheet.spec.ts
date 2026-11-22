import { describe, expect, it } from 'vitest';
import { buildSheet, readVisualCheck } from './visual-check-sheet.js';

const series = {
  ref: 'aaaaaaaaaaaa',
  number: 1,
  modality: 'CT',
  images: 30,
  multiFrameObjects: 0,
  dimensions: ['512 x 512'],
  sliceThicknessMm: [5],
  transferSyntaxes: ['1.2.840.10008.1.2.1'],
  secondaryCapture: false,
};
const record = {
  exams: [
    { exam: 1, ref: '111111111111', folders: ['exam-001'], lookClosely: [], series: [series] },
    {
      exam: 2,
      ref: '222222222222',
      folders: ['exam-002'],
      lookClosely: ['series 9 is a secondary capture, look at every image'],
      series: [series, series],
    },
  ],
};

/** The sheet as the arrival check writes it, with the four last columns filled in per exam. */
function filled(lines: Record<string, [string, string, string]>, separator = ','): string {
  return buildSheet(record)
    .trimEnd()
    .split('\r\n')
    .map((line, index) => {
      if (index === 0) return line;
      const ref = line.split(',')[1] ?? '';
      const answer = new Map(Object.entries(lines)).get(ref);
      return answer ? line.replace(/,,,,$/, `,${answer.join(',')},`) : line;
    })
    .join('\r\n')
    .replaceAll(',', separator);
}

describe('buildSheet', () => {
  it('has one line per exam, with what to look at and four empty columns to fill in', () => {
    const lines = buildSheet(record).trimEnd().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('1,111111111111,exam-001,1,30,,,,,');
    expect(lines[2]).toBe(
      '2,222222222222,exam-002,2,60,"series 9 is a secondary capture, look at every image",,,,',
    );
  });

  it('neutralises a cell a spreadsheet would run as a formula', () => {
    const sheet = buildSheet({
      exams: [{ ...record.exams[0]!, folders: ['=cmd'], lookClosely: ['+1'] }],
    });
    expect(sheet).toContain(",'=cmd,");
    expect(sheet).toContain(",'+1,");
  });
});

describe('readVisualCheck', () => {
  it('accepts a sheet on which every exam was looked at and found clear', () => {
    const verdict = readVisualCheck(
      filled({
        '111111111111': ['A. Reader', '2026-12-02', 'clear'],
        '222222222222': ['A. Reader', '2026-12-02', 'Clear'],
      }),
      record,
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.checks).toEqual([
      { exam: 1, checkedBy: 'A. Reader', checkedOn: '2026-12-02' },
      { exam: 2, checkedBy: 'A. Reader', checkedOn: '2026-12-02' },
    ]);
  });

  it('accepts the sheet as a spreadsheet set to French saves it, with semicolons', () => {
    const sheet = filled(
      {
        '111111111111': ['A. Reader', '2026-12-02', 'clear'],
        '222222222222': ['A. Reader', '2026-12-02', 'clear'],
      },
      ';',
    );
    expect(readVisualCheck(`${String.fromCharCode(0xfeff)}${sheet}`, record).ok).toBe(true);
  });

  it('refuses the sheet as written, before anyone has looked', () => {
    const verdict = readVisualCheck(buildSheet(record), record);
    expect(verdict.ok).toBe(false);
    expect(verdict.issues).toContain(
      'exam 1 (111111111111): nobody is named as having looked at it',
    );
    expect(verdict.checks).toEqual([]);
  });

  it.each([
    [['', '2026-12-02', 'clear'], /nobody is named/],
    [['A. Reader', '', 'clear'], /date of the check is missing/],
    [['A. Reader', '02/12/2026', 'clear'], /not YYYY-MM-DD/],
    [['A. Reader', '2026-12-02', ''], /result is not "clear"/],
    [['A. Reader', '2026-12-02', 'ok'], /result is not "clear"/],
    [['A. Reader', '2026-12-02', 'text-found'], /text was found in the images/],
  ] as Array<[[string, string, string], RegExp]>)(
    'refuses a line filled in as %j',
    (answer, issue) => {
      const verdict = readVisualCheck(
        filled({ '111111111111': answer, '222222222222': ['A. Reader', '2026-12-02', 'clear'] }),
        record,
      );
      expect(verdict.ok).toBe(false);
      expect(verdict.issues.join('\n')).toMatch(issue);
    },
  );

  it('refuses a sheet that lacks an exam, repeats one, or names one that is not in the record', () => {
    const complete = filled({
      '111111111111': ['A. Reader', '2026-12-02', 'clear'],
      '222222222222': ['A. Reader', '2026-12-02', 'clear'],
    }).split('\r\n');

    const missing = readVisualCheck(complete.slice(0, 2).join('\r\n'), record);
    expect(missing.issues).toContain('exam 2 (222222222222): no line on the sheet');

    const repeated = readVisualCheck([...complete, complete[1]].join('\r\n'), record);
    expect(repeated.issues.join('\n')).toMatch(/exam 1 .*2 lines on the sheet/);

    const foreign = readVisualCheck(
      [...complete, '3,333333333333,exam-003,1,30,,A. Reader,2026-12-02,clear,'].join('\r\n'),
      record,
    );
    expect(foreign.ok).toBe(false);
    expect(foreign.issues.join('\n')).toMatch(/not in the record/);
  });

  it('refuses a file that is not the sheet', () => {
    expect(readVisualCheck('a,b,c\r\n1,2,3\r\n', record).issues).toContain(
      'the sheet has no "exam_ref" column',
    );
  });
});
