import { describe, expect, it } from 'vitest';
import {
  DicomSeriesDetailSchema,
  DicomSeriesListSchema,
  DicomSeriesVersionQuerySchema,
  DicomViewSchema,
} from './dicom.js';

const summary = {
  id: '5fae91c3-e8c0-4dc9-a1f7-0f578f637f79',
  studyInstanceUid: '1.2.826.0.1.3680043.8.498.100',
  seriesInstanceUid: '1.2.826.0.1.3680043.8.498.200',
  modality: 'CT',
  seriesNumber: 2,
  instanceCount: 1,
  heldInstanceCount: 0,
  rows: 512,
  columns: 512,
};

const instance = {
  distributionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  url: 'https://storage.example.org/ct/slice.dcm?X-Amz-Signature=00',
  held: false,
  sopInstanceUid: '1.2.826.0.1.3680043.8.498.1',
  sopClassUid: '1.2.840.10008.5.1.4.1.1.2',
  transferSyntaxUid: '1.2.840.10008.1.2.1',
  instanceNumber: 1,
  rows: 512,
  columns: 512,
  bitsAllocated: 16,
  pixelRepresentation: 1,
  photometricInterpretation: 'MONOCHROME2',
  imagePositionPatient: [-100, -100, 0],
  imageOrientationPatient: [1, 0, 0, 0, 1, 0],
  pixelSpacing: [0.5, 0.5],
  sliceThickness: 5,
  windowCenter: 40,
  windowWidth: 80,
};

describe('DICOM series schemas (ADR-0026)', () => {
  it('accepts a version as it was published, and nothing else', () => {
    expect(DicomSeriesVersionQuerySchema.parse(undefined)).toBeUndefined();
    expect(DicomSeriesVersionQuerySchema.parse('1.0.0')).toBe('1.0.0');
    expect(DicomSeriesVersionQuerySchema.parse('2.1.0-rc.1')).toBe('2.1.0-rc.1');
    for (const bad of ['latest', '1.0', '', "1.0.0' OR 1=1", `1.0.0+${'a'.repeat(80)}`]) {
      expect(DicomSeriesVersionQuerySchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('accepts a series list and a series with its instances', () => {
    expect(
      DicomSeriesListSchema.safeParse({
        datasetSlug: 'ct-demo',
        version: '1.0.0',
        total: 1,
        series: [summary],
      }).success,
    ).toBe(true);
    expect(
      DicomSeriesDetailSchema.safeParse({
        ...summary,
        datasetSlug: 'ct-demo',
        version: '1.0.0',
        frameOfReferenceUid: null,
        expiresAt: '2026-11-20T12:15:00.000Z',
        instances: [instance],
      }).success,
    ).toBe(true);
  });

  it('accepts an instance whose header gave no geometry, and refuses a malformed one', () => {
    const bare = {
      ...instance,
      imagePositionPatient: null,
      imageOrientationPatient: null,
      pixelSpacing: null,
    };
    const detail = (one: unknown) => ({
      ...summary,
      datasetSlug: 'ct-demo',
      version: '1.0.0',
      frameOfReferenceUid: null,
      expiresAt: '2026-11-20T12:15:00.000Z',
      instances: [one],
    });

    expect(DicomSeriesDetailSchema.safeParse(detail(bare)).success).toBe(true);
    expect(
      DicomSeriesDetailSchema.safeParse(detail({ ...instance, imagePositionPatient: [0, 0] }))
        .success,
    ).toBe(false);
  });
});

describe('DICOM view stored with an answer (#674)', () => {
  const view = {
    distributionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    position: 12,
    imageCount: 30,
    window: { width: 80, center: 40 },
    inverted: false,
  };

  it('accepts the image drawn, its place in the stack and how it was displayed', () => {
    expect(DicomViewSchema.parse(view)).toEqual(view);
    expect(DicomViewSchema.safeParse({ ...view, window: null }).success).toBe(true);
    expect(DicomViewSchema.safeParse({ ...view, position: 30 }).success).toBe(true);
  });

  it('refuses a position outside the stack and a window that cannot be displayed', () => {
    for (const bad of [
      { ...view, position: 0 },
      { ...view, position: 31 },
      { ...view, position: 1.5 },
      { ...view, window: { width: 0, center: 40 } },
      { ...view, window: { width: Number.POSITIVE_INFINITY, center: 40 } },
      { ...view, window: { width: 80, center: Number.NaN } },
    ]) {
      expect(DicomViewSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('names the image by its distribution and carries no DICOM identifier', () => {
    expect(DicomViewSchema.safeParse({ ...view, distributionId: '1.2.826.0.1' }).success).toBe(
      false,
    );
    expect(
      DicomViewSchema.safeParse({ ...view, sopInstanceUid: '1.2.826.0.1.3680043.8.498.1' }).success,
    ).toBe(false);
  });
});
