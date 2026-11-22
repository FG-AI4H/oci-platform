import { describe, expect, it } from 'vitest';
import {
  AssignmentSampleResponseSchema,
  CANNOT_ASSESS_LABEL,
  dicomSeriesSampleRef,
  fileSampleRef,
  labelSubmissionProblems,
  parseDicomSeriesSampleRef,
  parseFileSampleRef,
  type ClassificationLabelsConfig,
} from './index.js';

const DIST = '11111111-1111-4111-8111-111111111111';

describe('file sample reference (#646)', () => {
  it('round-trips a distribution id', () => {
    expect(fileSampleRef(DIST)).toBe(`file:${DIST}`);
    expect(parseFileSampleRef(fileSampleRef(DIST))).toBe(DIST);
  });

  it.each(['ds/u1/IDRiD_001.jpg', 'file:IDRiD_001.jpg', `dicom-series:${DIST}`, DIST, 'file:'])(
    'is not a file reference: %s',
    (ref) => {
      expect(parseFileSampleRef(ref)).toBeNull();
    },
  );

  it('never reads as a series reference, nor a series one as a file', () => {
    expect(parseDicomSeriesSampleRef(fileSampleRef(DIST))).toBeNull();
    expect(parseFileSampleRef(dicomSeriesSampleRef(DIST))).toBeNull();
  });
});

describe('AssignmentSampleResponseSchema (#646)', () => {
  const expiresAt = '2026-11-23T10:05:00.000Z';

  it('takes an image tagged by kind', () => {
    const image = {
      kind: 'image',
      url: 'https://s3.example/x',
      contentType: 'image/png',
      expiresAt,
    };
    expect(AssignmentSampleResponseSchema.parse(image)).toEqual(image);
  });

  it('refuses an image that carries anything else, such as a file name', () => {
    expect(
      AssignmentSampleResponseSchema.safeParse({
        kind: 'image',
        url: 'https://s3.example/x',
        contentType: 'image/png',
        expiresAt,
        fileName: 'IDRiD_001.jpg',
      }).success,
    ).toBe(false);
  });

  it('refuses a sample without a kind', () => {
    expect(
      AssignmentSampleResponseSchema.safeParse({
        files: [{ url: 'https://s3.example/x', contentType: 'image/png' }],
        expiresAt,
      }).success,
    ).toBe(false);
  });
});

describe('labelSubmissionProblems: optional view (#646, #674)', () => {
  const labels: ClassificationLabelsConfig = {
    labels: [
      { value: 'normal', display: 'Normal' },
      { value: 'abnormal', display: 'Abnormal' },
    ],
    cannotAssess: true,
    allowComment: true,
  };
  const view = {
    distributionId: DIST,
    position: 3,
    imageCount: 40,
    window: { width: 400, center: 40 },
    inverted: false,
  };

  it('accepts an answer without a view', () => {
    expect(labelSubmissionProblems(labels, { label: 'normal' })).toEqual([]);
  });

  it('accepts a valid view, at every gate', () => {
    expect(labelSubmissionProblems(labels, { label: 'abnormal', view })).toEqual([]);
    expect(
      labelSubmissionProblems(
        labels,
        { label: CANNOT_ASSESS_LABEL, reason: 'too noisy', view },
        { reasonRequired: true },
      ),
    ).toEqual([]);
  });

  it('refuses a view that is not a record of the screen', () => {
    expect(
      labelSubmissionProblems(labels, { label: 'normal', view: { ...view, position: 41 } }),
    ).toEqual(['view is not a valid record of the screen']);
    expect(labelSubmissionProblems(labels, { label: 'normal', view: 'slice 3' })).toEqual([
      'view is not a valid record of the screen',
    ]);
  });
});
