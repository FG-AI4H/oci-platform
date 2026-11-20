import { z } from 'zod';

/**
 * DICOM series, as the two read endpoints return them (ADR-0026).
 *
 *   GET /v2/storage/datasets/:slug/dicom/series   the series of a version
 *   GET /v2/storage/dicom/series/:id              one series, its instances
 *                                                 in display order, each with
 *                                                 a short-lived storage address
 *
 * Everything here comes from the header index. No pixel data is read to
 * build it, and nothing here is a value the de-identification check
 * flags: UIDs, geometry and display parameters only.
 *
 * A series is made of single-frame images. A file whose header could
 * not be read belongs to no series: it shows in the dataset's file
 * list, for its host and platform operators, and nowhere here.
 */

/**
 * `?version=` on both routes: a version of the dataset, as it was
 * published (`1.0.0`). Absent means the latest one.
 */
export const DicomSeriesVersionQuerySchema = z
  .string()
  .max(40)
  // Bounded by .max(40) above; the optional suffix group cannot blow up.
  // The same pattern as `PublishDatasetVersionRequestSchema.version`.
  // eslint-disable-next-line security/detect-unsafe-regex
  .regex(/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/, 'expected semver MAJOR.MINOR.PATCH')
  .optional();

export const DicomSeriesSummarySchema = z.object({
  /** The platform's own id for the series. Stable across dataset versions. */
  id: z.string().uuid(),
  studyInstanceUid: z.string().nullable(),
  seriesInstanceUid: z.string(),
  modality: z.string().nullable(),
  seriesNumber: z.number().int().nullable(),
  /**
   * Single-frame images the caller can open, held ones included. Other
   * DICOM objects (reports, multi-frame objects) are not counted.
   */
  instanceCount: z.number().int().nonnegative(),
  /**
   * How many of them are held: files with undecided de-identification
   * findings (ADR-0026). Only the dataset's host and platform operators
   * ever see a held instance, so this is 0 for everyone else.
   */
  heldInstanceCount: z.number().int().nonnegative(),
  /**
   * Pixel rows and columns of the instances; null unless every
   * instance states the same value.
   */
  rows: z.number().int().nullable(),
  columns: z.number().int().nullable(),
});
export type DicomSeriesSummary = z.infer<typeof DicomSeriesSummarySchema>;

export const DicomSeriesListSchema = z.object({
  datasetSlug: z.string(),
  /** The dataset version the list was read from. */
  version: z.string(),
  /**
   * How many series the caller can open in this version. `series`
   * holds at most the first 500 of them, by study then series number.
   */
  total: z.number().int().nonnegative(),
  series: z.array(DicomSeriesSummarySchema),
});
export type DicomSeriesList = z.infer<typeof DicomSeriesListSchema>;

export const DicomSeriesInstanceSchema = z.object({
  /** The distribution this instance is, in the version read. */
  distributionId: z.string().uuid(),
  /**
   * Where the browser fetches the file: a signed storage address that
   * stops working at `expiresAt`. Not a path on this site.
   */
  url: z.string(),
  /** True when the file is held; only its host and operators get it. */
  held: z.boolean(),
  sopInstanceUid: z.string().nullable(),
  sopClassUid: z.string().nullable(),
  transferSyntaxUid: z.string().nullable(),
  instanceNumber: z.number().int().nullable(),
  rows: z.number().int().nullable(),
  columns: z.number().int().nullable(),
  bitsAllocated: z.number().int().nullable(),
  pixelRepresentation: z.number().int().nullable(),
  photometricInterpretation: z.string().nullable(),
  /** x, y, z in millimetres. */
  imagePositionPatient: z.array(z.number()).length(3).nullable(),
  /** Row then column direction cosines. */
  imageOrientationPatient: z.array(z.number()).length(6).nullable(),
  /** Row then column spacing in millimetres. */
  pixelSpacing: z.array(z.number()).length(2).nullable(),
  sliceThickness: z.number().nullable(),
  /** The window the file itself proposes, when it proposes one. */
  windowCenter: z.number().nullable(),
  windowWidth: z.number().nullable(),
});
export type DicomSeriesInstance = z.infer<typeof DicomSeriesInstanceSchema>;

export const DicomSeriesDetailSchema = DicomSeriesSummarySchema.extend({
  datasetSlug: z.string(),
  version: z.string(),
  frameOfReferenceUid: z.string().nullable(),
  /**
   * The instance addresses work at least until then. Ask for the
   * series again after that, or when storage refuses one.
   */
  expiresAt: z.string().datetime(),
  /** In display order: along the stack, in the scanner's own direction. */
  instances: z.array(DicomSeriesInstanceSchema),
});
export type DicomSeriesDetail = z.infer<typeof DicomSeriesDetailSchema>;
