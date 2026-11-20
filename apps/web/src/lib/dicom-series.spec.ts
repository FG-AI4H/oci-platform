import type { DicomSeriesSummary } from '@oci/shared-types';
import { describe, expect, it } from 'vitest';
import { heldImageCount, seriesRows } from './dicom-series';

const series = (overrides: Partial<DicomSeriesSummary> = {}): DicomSeriesSummary => ({
  id: '5fae91c3-e8c0-4dc9-a1f7-0f578f637f79',
  studyInstanceUid: '1.2.826.0.1.3680043.8.498.100',
  seriesInstanceUid: '1.2.826.0.1.3680043.8.498.200',
  modality: 'CT',
  seriesNumber: 3,
  instanceCount: 49,
  heldInstanceCount: 0,
  rows: 512,
  columns: 512,
  ...overrides,
});

describe('seriesRows', () => {
  it('names a series by modality and number, and says how many images and what size', () => {
    expect(seriesRows([series()])).toEqual([
      {
        id: '5fae91c3-e8c0-4dc9-a1f7-0f578f637f79',
        title: 'CT series 3',
        meta: '49 images · 512 × 512',
        held: null,
        heldCount: 0,
      },
    ]);
  });

  it('numbers the exams when the dataset holds more than one', () => {
    const rows = seriesRows([
      series({ id: 'a', studyInstanceUid: '1.1', seriesNumber: 1 }),
      series({ id: 'b', studyInstanceUid: '1.1', seriesNumber: 2 }),
      series({ id: 'c', studyInstanceUid: '1.2', seriesNumber: 1 }),
    ]);

    expect(rows.map((row) => row.title)).toEqual([
      'Exam 1 · CT series 1',
      'Exam 1 · CT series 2',
      'Exam 2 · CT series 1',
    ]);
  });

  it('tells apart series that would otherwise carry the same name', () => {
    // SeriesNumber is optional and often repeated.
    const rows = seriesRows([
      series({ id: 'a', seriesNumber: null }),
      series({ id: 'b', seriesNumber: null }),
      series({ id: 'c', seriesNumber: 2 }),
      series({ id: 'd', seriesNumber: null }),
    ]);

    expect(rows.map((row) => row.title)).toEqual([
      'CT series (1 of 3)',
      'CT series (2 of 3)',
      'CT series 2',
      'CT series (3 of 3)',
    ]);
    expect(new Set(rows.map((row) => row.title)).size).toBe(rows.length);
  });

  it('never shows a DICOM UID', () => {
    const text = JSON.stringify(
      seriesRows([series(), series({ id: 'b', studyInstanceUid: '1.2.826.9' })]).map((row) => [
        row.title,
        row.meta,
      ]),
    );
    expect(text).not.toContain('1.2.826');
  });

  it('copes with a header that states no modality, number or size', () => {
    const [row] = seriesRows([
      series({ modality: null, seriesNumber: null, rows: null, instanceCount: 1 }),
    ]);

    expect(row).toMatchObject({ title: 'DICOM series', meta: '1 image' });
  });

  it('says whether all or some of a series is held', () => {
    const rows = seriesRows([
      series({ id: 'a', heldInstanceCount: 49 }),
      series({ id: 'b', heldInstanceCount: 3 }),
      series({ id: 'c' }),
    ]);

    expect(rows.map((row) => [row.held, row.heldCount])).toEqual([
      ['all', 49],
      ['some', 3],
      [null, 0],
    ]);
    expect(
      heldImageCount([series({ heldInstanceCount: 49 }), series({ heldInstanceCount: 3 })]),
    ).toBe(52);
  });
});
