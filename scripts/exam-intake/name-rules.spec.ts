import { describe, expect, it } from 'vitest';
import { judgePath, MAX_COUNTER_DIGITS, nameProblem } from './name-rules.js';

describe('nameProblem', () => {
  it.each([
    'exam-001',
    'EXAM_12',
    'series-01',
    'Serie 3',
    '0001.dcm',
    'IM000042',
    'I0001.DCM',
    'image-00017.dicom',
    'ct-brain-axial-5mm',
    'tdm-crane',
    'DICOMDIR',
    '1.2.826.0.1.3680043.8.498.658.1.1.1',
    '1.2.826.0.1.3680043.8.498.658.1.1.1.dcm',
    'CT.1.2.826.0.1.3680043.8.498.658.1.1.1.dcm',
    '3f2b8c1e-9a4d-4e7f-8b21-0c5d6e7f8a9b',
    '9f86d081884c7d659a2feaa0c55ad015',
  ])('accepts %s', (name) => {
    expect(nameProblem(name)).toBeNull();
  });

  it.each([
    ['QUILLFEATHER_ZORBLAX', /word outside the naming convention/],
    ['Zorblax Quillfeather', /word outside the naming convention/],
    ['exam-zorblax', /word outside the naming convention/],
    ['ZQ', /word outside the naming convention/],
    ['exam-12345678', /number of more than 5 digits/],
    ['00123456', /number of more than 5 digits/],
    ['19990101', /number of more than 5 digits/],
    ['exam_1999-01-31', /reads as a date/],
    ['31.01.1999', /reads as a date/],
    ['exam 31_01_1999 ct', /reads as a date/],
    ['Zörblax', /character other than/],
    ['examen-n°3', /character other than/],
    ['.dcm', /empty/],
    // Sixteen digits are a number, not a random identifier.
    ['1234567890123456', /number of more than 5 digits/],
    // Too few components to be a UID: the same shape as a date or a record number.
    ['12.3456789', /number of more than 5 digits/],
  ])('refuses %s', (name, reason) => {
    expect(nameProblem(name)).toMatch(reason);
  });

  it('never repeats the name in the reason', () => {
    for (const name of ['QUILLFEATHER_ZORBLAX', '19990101', 'exam_1999-01-31', 'Zörblax']) {
      const reason = nameProblem(name) ?? '';
      expect(reason).not.toMatch(/QUILL|ZORBLAX|1999|Zörblax/);
    }
  });

  it('counts leading zeros as padding, not as digits', () => {
    expect(nameProblem(`${'0'.repeat(10)}${'9'.repeat(MAX_COUNTER_DIGITS)}`)).toBeNull();
    expect(nameProblem(`0${'9'.repeat(MAX_COUNTER_DIGITS + 1)}`)).not.toBeNull();
  });
});

describe('judgePath', () => {
  const position = () => ({ index: 2, of: 7 });

  it('leaves a path that follows the convention as it is', () => {
    expect(judgePath('exam-001/series-01/0001.dcm', position)).toEqual({
      display: 'exam-001/series-01/0001.dcm',
      problems: [],
    });
  });

  it('withholds a refused component and says where it is instead', () => {
    const judged = judgePath('exam-001/Zorblax/0001.dcm', position);
    expect(judged.display).toBe('exam-001/[name withheld: entry 2 of 7]/0001.dcm');
    expect(judged.problems).toEqual([
      {
        display: 'exam-001/[name withheld: entry 2 of 7]',
        reason: expect.stringMatching(/word outside/),
        isFile: false,
      },
    ]);
    expect(JSON.stringify(judged)).not.toContain('Zorblax');
  });
});
