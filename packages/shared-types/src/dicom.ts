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

// ==== Operator review of held files (ADR-0026, decision 2) ================
//
// A DICOM file whose header carries a value de-identification normally
// removes is held. A platform operator looks at the findings of a
// dataset and accepts them, with a reason; a file is released when
// every one of its findings is accepted.
//
//   GET  /v2/storage/dicom/held                                  datasets with held files
//   GET  /v2/storage/datasets/:slug/dicom/findings               undecided findings
//   POST /v2/storage/datasets/:slug/dicom/findings/decisions     accept some, with a reason
//
// Operators only. Until a separate role exists, that is the `admin` group.

/** One finding, named the way the index names it. Never by its value. */
export const DicomFindingRefSchema = z.object({
  /** DICOM keyword, or a whole-file finding such as `PrivateTags`. */
  attribute: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z]+$/, 'expected a DICOM keyword'),
  /** Keyed digest of the value, as the findings list returned it. */
  valueDigest: z.string().regex(/^[0-9a-f]{64}$/, 'expected a digest from the findings list'),
});
export type DicomFindingRef = z.infer<typeof DicomFindingRefSchema>;

export const RecordDicomFindingDecisionRequestSchema = z.object({
  /**
   * Why these values do not identify anyone, in the operator's words.
   * It is kept in the audit trail, so it must not repeat a value.
   */
  reason: z.string().trim().min(10, 'give a reason of at least 10 characters').max(2000),
  findings: z.array(DicomFindingRefSchema).min(1, 'select at least one finding').max(500),
});
export type RecordDicomFindingDecisionRequest = z.infer<
  typeof RecordDicomFindingDecisionRequestSchema
>;

/** A dataset with at least one held file, in the operator's queue. */
export interface DicomHeldDatasetSummary {
  slug: string;
  name: string;
  /** Files held for undecided findings. */
  heldInstanceCount: number;
  /** Files held because their header could not be read. No decision releases these. */
  unreadableInstanceCount: number;
}

export interface DicomHeldDatasetList {
  datasets: DicomHeldDatasetSummary[];
}

/** One undecided (attribute, value) of a dataset, across its held files. */
export interface DicomUndecidedFinding extends DicomFindingRef {
  /**
   * The value, read from a stored file for this response and stored
   * nowhere else. It may identify a patient: show it to the operator,
   * never log or keep it. Null when it could not be read back.
   */
  value: string | null;
  /** True when `value` is only the beginning of a longer value. */
  valueTruncated: boolean;
  /**
   * True for a finding about a file as a whole (a burned-in annotation
   * flag, private tags, content the check did not reach). Accepting it
   * covers the files held now, and no file uploaded later.
   */
  wholeFile: boolean;
  /**
   * False when the platform will refuse to accept it: a value that
   * could not be read back, or that is too long to be shown whole. An
   * operator cannot vouch for what they were not shown.
   */
  acceptable: boolean;
  /** Held files that carry this value. */
  instanceCount: number;
  /** Series those files belong to. */
  seriesCount: number;
}

export interface DicomFindingDecisionSummary {
  id: string;
  reason: string;
  decidedAt: string;
  /** How many (attribute, value) pairs it accepted. */
  acceptedFindingCount: number;
}

export interface DicomFindingsReview {
  datasetSlug: string;
  datasetName: string;
  heldInstanceCount: number;
  unreadableInstanceCount: number;
  /** Undecided findings, by attribute, the most frequent first. At most 500. */
  findings: DicomUndecidedFinding[];
  /** How many undecided findings there are in all. */
  totalFindings: number;
  /** Decisions already recorded for this dataset, the latest first. */
  decisions: DicomFindingDecisionSummary[];
}

export interface DicomFindingDecisionResult {
  decisionId: string;
  acceptedFindingCount: number;
  /** Files this decision released: every finding of theirs is now accepted. */
  releasedInstanceCount: number;
  /** Files of the dataset still held for other findings. */
  stillHeldInstanceCount: number;
}
