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

/**
 * What the built-in viewer had on screen: the image drawn and how it
 * was displayed. An annotation answer about a series stores it as its
 * optional `view`, for the record and for reviewing a disagreement;
 * agreement and arbitration ignore it (#674, ADR-0026).
 *
 * The image is named by its distribution, never by a DICOM UID: the
 * answer lands in the audit trail and in exports.
 */
export const DicomViewSchema = z
  .object({
    /** The distribution of the image drawn. */
    distributionId: z.string().uuid(),
    /** Its place in the series' display order, from 1. */
    position: z.number().int().min(1),
    /** How many images the series had on screen. */
    imageCount: z.number().int().min(1),
    /** The window as the screen showed it; null if none was set. */
    window: z
      .object({ width: z.number().min(1), center: z.number() })
      .strict()
      .nullable(),
    inverted: z.boolean(),
  })
  .strict()
  .refine((view) => view.position <= view.imageCount, {
    message: 'position is past the last image',
    path: ['position'],
  });
export type DicomView = z.infer<typeof DicomViewSchema>;

/**
 * Check the `view` of an answer against the task's sample (#674).
 *
 * An answer about a series must say what was on screen: the reader's
 * slice and window are part of the record. `imageIds` is the series'
 * images as distribution ids in display order; `null` when the sample
 * is not a series, and then an answer carries no view. Returns the
 * reasons it is refused; empty when it is accepted.
 */
export function answerViewProblems(view: unknown, imageIds: readonly string[] | null): string[] {
  if (imageIds === null) {
    return view === undefined ? [] : ['an answer on an image carries no view'];
  }
  if (view === undefined) {
    return ['an answer on a series says which image was on screen (view)'];
  }
  const parsed = DicomViewSchema.safeParse(view);
  if (!parsed.success) return ['view is not a valid record of the screen'];
  const { distributionId, position, imageCount } = parsed.data;
  if (imageCount !== imageIds.length) {
    return [`view counts ${imageCount} images; the series has ${imageIds.length}`];
  }
  if (imageIds[position - 1] !== distributionId) {
    return [`view names an image that is not image ${position} of this series`];
  }
  return [];
}

/** What the built-in viewer needs of a series, wherever it comes from. */
export type DicomViewerSeries = Pick<DicomSeriesDetail, 'modality' | 'expiresAt' | 'instances'>;

// ==== A DICOM series as the sample of an annotation task (#674, #646) ====
//
// A task points at its sample by a typed platform id, never by a
// storage key: the reference goes into the append-only audit trail and
// into exports, and a key carries the file name as uploaded.
//
//   file:<distribution id>     an image file (#646)
//   dicom-series:<series id>   a DICOM series, resolved against the
//                              campaign's pinned dataset version
//
// The sample address of a task answers with a `kind`. This is the
// `dicom-series` one. It carries what the viewer needs, and no field
// names the dataset: a reader usually has no access to the dataset
// itself, and blinding (ADR-0010) keeps its name off the screen. The
// signed addresses do carry the storage key (`<slug>/<uuid>/<name>`),
// as every download address does, and the files carry their full
// header (ADR-0026): neither is shown, neither is hidden.

const DICOM_SERIES_SAMPLE_PREFIX = 'dicom-series:';

/** The sample reference of a task on a DICOM series. */
export function dicomSeriesSampleRef(seriesId: string): string {
  return `${DICOM_SERIES_SAMPLE_PREFIX}${seriesId}`;
}

/** The series id of a `dicom-series:` reference, or null for any other. */
export function parseDicomSeriesSampleRef(sampleRef: string): string | null {
  if (!sampleRef.startsWith(DICOM_SERIES_SAMPLE_PREFIX)) return null;
  const id = sampleRef.slice(DICOM_SERIES_SAMPLE_PREFIX.length);
  return z.string().uuid().safeParse(id).success ? id : null;
}

/** The `dicom-series` answer of a task's sample address. */
export const DicomSeriesSampleSchema = z
  .object({
    kind: z.literal('dicom-series'),
    modality: z.string().nullable(),
    /** The instance addresses work at least until then. */
    expiresAt: z.string().datetime(),
    /** In display order. Never a held file: the whole sample is refused instead. */
    instances: z.array(DicomSeriesInstanceSchema).min(1),
  })
  .strict();
export type DicomSeriesSample = z.infer<typeof DicomSeriesSampleSchema>;

/** A series a campaign can make a task of, as task creation reads it. */
export interface DicomSeriesTaskCandidate {
  /** What the task stores as its sample reference. */
  sampleRef: string;
  seriesId: string;
  modality: string | null;
  seriesNumber: number | null;
  imageCount: number;
  /**
   * Images held for de-identification findings. A series with any is
   * not made into a task: a held file never reaches a reader.
   */
  heldImageCount: number;
}

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
