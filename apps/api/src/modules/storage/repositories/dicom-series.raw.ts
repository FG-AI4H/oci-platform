import { Prisma, type PrismaClient } from '@oci/database';
import { DICOM_HELD_STATUSES } from '../../../common/dicom-hold.js';

/**
 * Reads behind the two DICOM series endpoints (#674, ADR-0026).
 *
 * Raw because the index is keyed by where the bytes live, not by
 * distribution: a new dataset version adopts the stored files of the
 * previous one, so "the instances of this series in this version" is a
 * join on (s3_bucket, s3_key), which the Prisma schema has no relation
 * for. Every value is a bound parameter.
 *
 * What both queries read, and nothing else:
 *   - distributions of ONE dataset version, hosted by the platform,
 *     fully uploaded, and not individually access-gated (the same three
 *     conditions as the whole-dataset archive);
 *   - whose stored file is indexed as a single-frame image for THIS
 *     dataset. ADR-0026 offers nothing else to the viewer: reports,
 *     presentation states and multi-frame objects are indexed as
 *     present and not displayed. A file whose header could not be read
 *     has no series and no kind, so it is never here either;
 *   - held files only when `includeHeld` is set. Callers set it for the
 *     dataset's host and for platform operators, for nobody else.
 */

const HELD = Prisma.join(
  DICOM_HELD_STATUSES.map((status) => Prisma.sql`${status}::"catalog"."DicomCheckStatus"`),
);

export interface SeriesScope {
  datasetId: string;
  versionId: string;
  includeHeld: boolean;
}

/**
 * One row per indexed image in scope. `DISTINCT ON` because two
 * distributions of a version can point at the same stored file; the
 * instance is still one instance.
 */
function instancesInScope(scope: SeriesScope, seriesInstanceUid?: string): Prisma.Sql {
  const heldClause = scope.includeHeld
    ? Prisma.empty
    : Prisma.sql`AND o.check_status NOT IN (${HELD})`;
  const seriesClause =
    seriesInstanceUid === undefined
      ? Prisma.sql`AND o.series_instance_uid IS NOT NULL`
      : Prisma.sql`AND o.series_instance_uid = ${seriesInstanceUid}`;
  return Prisma.sql`
    SELECT DISTINCT ON (o.id)
      o.*,
      d.id AS distribution_id,
      (o.check_status IN (${HELD})) AS held
    FROM catalog.distributions d
    JOIN catalog.dicom_objects o ON o.s3_bucket = d.s3_bucket AND o.s3_key = d.s3_key
    WHERE d.dataset_version_id = ${scope.versionId}::uuid
      AND d.storage_backend = 'S3'
      AND d.upload_status = 'READY'
      AND d.requires_access = false
      AND o.dataset_id = ${scope.datasetId}::uuid
      AND o.object_kind = 'SINGLE_FRAME_IMAGE'
      ${seriesClause}
      ${heldClause}
    ORDER BY o.id, d.id`;
}

export interface SeriesSummaryRow {
  id: string;
  series_instance_uid: string;
  study_instance_uid: string | null;
  modality: string | null;
  series_number: number | null;
  instance_count: number;
  held_instance_count: number;
  /** Null unless every instance states the same value. */
  rows: number | null;
  columns: number | null;
  /** Series in scope, before `limit` was applied. */
  total: number;
}

/**
 * The series of one dataset version, by study, then series number,
 * then UID. A series with no instance in scope is not returned, so a
 * series whose every file is held does not exist for a caller who may
 * not see held files.
 */
export function listSeriesSummaries(
  client: PrismaClient,
  scope: SeriesScope & { limit: number },
): Promise<SeriesSummaryRow[]> {
  return client.$queryRaw<SeriesSummaryRow[]>(Prisma.sql`
    WITH instance AS (${instancesInScope(scope)})
    SELECT
      s.id,
      s.series_instance_uid,
      min(i.study_instance_uid) AS study_instance_uid,
      min(i.modality) AS modality,
      min(i.series_number) AS series_number,
      count(*)::int AS instance_count,
      (count(*) FILTER (WHERE i.held))::int AS held_instance_count,
      CASE WHEN count(i.rows) = count(*) AND min(i.rows) = max(i.rows)
           THEN min(i.rows) END AS rows,
      CASE WHEN count(i.columns) = count(*) AND min(i.columns) = max(i.columns)
           THEN min(i.columns) END AS columns,
      (count(*) OVER ())::int AS total
    FROM instance i
    JOIN catalog.dicom_series s
      ON s.dataset_id = i.dataset_id AND s.series_instance_uid = i.series_instance_uid
    GROUP BY s.id, s.series_instance_uid
    ORDER BY min(i.study_instance_uid) NULLS LAST, min(i.series_number) NULLS LAST,
             s.series_instance_uid
    LIMIT ${scope.limit}`);
}

export interface SeriesInstanceRow {
  distribution_id: string;
  s3_bucket: string;
  s3_key: string;
  held: boolean;
  sop_class_uid: string | null;
  sop_instance_uid: string | null;
  study_instance_uid: string | null;
  frame_of_reference_uid: string | null;
  transfer_syntax_uid: string | null;
  modality: string | null;
  series_number: number | null;
  instance_number: number | null;
  image_position_patient: number[] | null;
  image_orientation_patient: number[] | null;
  rows: number | null;
  columns: number | null;
  bits_allocated: number | null;
  pixel_representation: number | null;
  photometric_interpretation: string | null;
  slice_thickness: number | null;
  pixel_spacing: number[] | null;
  window_center: number | null;
  window_width: number | null;
}

/** The instances of one series in one dataset version, in no order. */
export function listSeriesInstances(
  client: PrismaClient,
  scope: SeriesScope & { seriesInstanceUid: string },
): Promise<SeriesInstanceRow[]> {
  return client.$queryRaw<SeriesInstanceRow[]>(Prisma.sql`
    SELECT
      i.distribution_id, i.s3_bucket, i.s3_key, i.held,
      i.sop_class_uid, i.sop_instance_uid, i.study_instance_uid, i.frame_of_reference_uid,
      i.transfer_syntax_uid, i.modality, i.series_number, i.instance_number,
      i.image_position_patient, i.image_orientation_patient, i.rows, i.columns,
      i.bits_allocated, i.pixel_representation,
      i.photometric_interpretation, i.slice_thickness, i.pixel_spacing,
      i.window_center, i.window_width
    FROM (${instancesInScope(scope, scope.seriesInstanceUid)}) i`);
}
