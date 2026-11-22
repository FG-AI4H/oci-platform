import { Prisma, type PrismaClient } from '@oci/database';
import { WHOLE_FILE_FINDING_ATTRIBUTES } from '@oci/dicom';

/**
 * Reads and bulk writes behind the operator's review of held DICOM
 * files (#674, ADR-0026, decision 2).
 *
 * Raw because every one of them is a set operation over findings: "the
 * findings of this dataset that nobody accepted", "the held files whose
 * every finding is accepted". Prisma's typed filters express neither.
 * Every value is a bound parameter.
 *
 * WHEN A FINDING IS ACCEPTED. There are two kinds, and the difference
 * is the point of this file:
 *
 *  - A finding with a value (a patient id, a date) is accepted for the
 *    DATASET: a row in `dicom_accepted_findings` for the same dataset,
 *    attribute and value digest. It covers the same value in a file
 *    uploaded later. A decision on one dataset never covers another.
 *
 *  - A finding about a file as a whole (`WHOLE_FILE_FINDING_ATTRIBUTES`:
 *    a burned-in annotation flag, private tags, content the check did
 *    not reach) is accepted on ONE FILE: `accepted_decision_id` on that
 *    file's own finding row. Its digest is the same for every file that
 *    has the flag, so a dataset-wide acceptance would release files
 *    nobody looked at. A row in `dicom_accepted_findings` for such an
 *    attribute, should one ever exist, is ignored.
 */

/** Either the client or an interactive transaction. */
type Db = Pick<PrismaClient, '$queryRaw'>;

const WHOLE_FILE = Prisma.join(WHOLE_FILE_FINDING_ATTRIBUTES);

/** True for a finding row `f` of a stored file `o` that is accepted. */
const accepted = (object: string, finding: string): Prisma.Sql => Prisma.sql`
  (
    ${Prisma.raw(finding)}.accepted_decision_id IS NOT NULL
    OR (
      ${Prisma.raw(finding)}.attribute NOT IN (${WHOLE_FILE})
      AND EXISTS (
        SELECT 1 FROM catalog.dicom_accepted_findings a
        WHERE a.dataset_id = ${Prisma.raw(object)}.dataset_id
          AND a.attribute = ${Prisma.raw(finding)}.attribute
          AND a.value_digest = ${Prisma.raw(finding)}.value_digest
      )
    )
  )`;

/**
 * Serialises, per dataset, the two things that must not miss each
 * other: indexing a file that has findings, and recording a decision.
 * Without it a file indexed while a decision commits is seen by
 * neither, and stays held although everything on it is accepted. Held
 * until the transaction ends.
 */
export async function lockDatasetFindings(db: Db, datasetId: string): Promise<void> {
  // The lock function returns `void`, which the driver cannot read
  // back: select a constant beside it.
  await db.$queryRaw(
    Prisma.sql`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`dicom-findings:${datasetId}`}, 0))) AS l`,
  );
}

export interface HeldDatasetRow {
  slug: string;
  name: string;
  held_instance_count: number;
  unreadable_instance_count: number;
}

/** Datasets with at least one held file, the most held first. */
export function listHeldDatasets(db: Db, limit: number): Promise<HeldDatasetRow[]> {
  return db.$queryRaw<HeldDatasetRow[]>(Prisma.sql`
    SELECT d.slug, d.name,
      (count(*) FILTER (WHERE o.check_status = 'HELD'))::int AS held_instance_count,
      (count(*) FILTER (WHERE o.check_status = 'UNREADABLE'))::int AS unreadable_instance_count
    FROM catalog.dicom_objects o
    JOIN catalog.datasets d ON d.id = o.dataset_id
    WHERE o.check_status IN ('HELD', 'UNREADABLE')
    GROUP BY d.id, d.slug, d.name
    ORDER BY count(*) DESC, d.slug
    LIMIT ${limit}`);
}

export interface HeldCountsRow {
  held_instance_count: number;
  unreadable_instance_count: number;
}

export async function countHeld(db: Db, datasetId: string): Promise<HeldCountsRow> {
  const rows = await db.$queryRaw<HeldCountsRow[]>(Prisma.sql`
    SELECT
      (count(*) FILTER (WHERE check_status = 'HELD'))::int AS held_instance_count,
      (count(*) FILTER (WHERE check_status = 'UNREADABLE'))::int AS unreadable_instance_count
    FROM catalog.dicom_objects
    WHERE dataset_id = ${datasetId}::uuid`);
  return rows[0] ?? { held_instance_count: 0, unreadable_instance_count: 0 };
}

export interface UndecidedFindingRow {
  attribute: string;
  value_digest: string;
  instance_count: number;
  series_count: number;
  /** One held file that carries the finding, to read its value back from. */
  sample_s3_bucket: string;
  sample_s3_key: string;
  /** Undecided findings in all, before `limit`. */
  total: number;
}

/**
 * The (attribute, value digest) pairs found on held files of a dataset
 * and not accepted, by attribute, the most frequent first. With
 * `only`, restricted to the pairs given: what a decision may accept is
 * exactly what this returns, so an operator cannot accept a value no
 * held file of the dataset shows.
 */
export function listUndecidedFindings(
  db: Db,
  args: {
    datasetId: string;
    limit: number;
    only?: ReadonlyArray<{ attribute: string; valueDigest: string }>;
  },
): Promise<UndecidedFindingRow[]> {
  const onlyClause =
    args.only === undefined
      ? Prisma.empty
      : Prisma.sql`AND (f.attribute, f.value_digest) IN (${Prisma.join(
          args.only.map((f) => Prisma.sql`(${f.attribute}, ${f.valueDigest})`),
        )})`;
  return db.$queryRaw<UndecidedFindingRow[]>(Prisma.sql`
    SELECT f.attribute, f.value_digest,
      count(DISTINCT o.id)::int AS instance_count,
      count(DISTINCT o.series_instance_uid)::int AS series_count,
      (array_agg(o.s3_bucket ORDER BY o.s3_key))[1] AS sample_s3_bucket,
      min(o.s3_key) AS sample_s3_key,
      (count(*) OVER ())::int AS total
    FROM catalog.dicom_findings f
    JOIN catalog.dicom_objects o ON o.id = f.dicom_object_id
    WHERE o.dataset_id = ${args.datasetId}::uuid
      AND o.check_status = 'HELD'
      AND NOT ${accepted('o', 'f')}
      ${onlyClause}
    GROUP BY f.attribute, f.value_digest
    ORDER BY f.attribute, count(DISTINCT o.id) DESC, f.value_digest
    LIMIT ${args.limit}`);
}

/**
 * Accept findings with a value for the dataset. Returns the pairs that
 * were really inserted: a pair accepted a moment ago by someone else
 * is not in the answer, and is not this decision's.
 */
export function acceptForDataset(
  db: Db,
  args: {
    decisionId: string;
    datasetId: string;
    findings: ReadonlyArray<{ attribute: string; valueDigest: string }>;
  },
): Promise<Array<{ attribute: string; value_digest: string }>> {
  const rows = Prisma.join(
    args.findings.map(
      (f) =>
        Prisma.sql`(gen_random_uuid(), ${args.decisionId}::uuid, ${args.datasetId}::uuid, ${f.attribute}, ${f.valueDigest})`,
    ),
  );
  return db.$queryRaw(Prisma.sql`
    INSERT INTO catalog.dicom_accepted_findings
      (id, decision_id, dataset_id, attribute, value_digest)
    VALUES ${rows}
    ON CONFLICT (dataset_id, attribute, value_digest) DO NOTHING
    RETURNING attribute, value_digest`);
}

/**
 * Accept whole-file findings on the files of the dataset that are held
 * right now, and on no other. Returns, per pair, how many files.
 */
export function acceptOnHeldFiles(
  db: Db,
  args: {
    decisionId: string;
    datasetId: string;
    findings: ReadonlyArray<{ attribute: string; valueDigest: string }>;
  },
): Promise<Array<{ attribute: string; value_digest: string; instance_count: number }>> {
  const pairs = Prisma.join(
    args.findings.map((f) => Prisma.sql`(${f.attribute}, ${f.valueDigest})`),
  );
  return db.$queryRaw(Prisma.sql`
    WITH marked AS (
      UPDATE catalog.dicom_findings f
      SET accepted_decision_id = ${args.decisionId}::uuid
      FROM catalog.dicom_objects o
      WHERE o.id = f.dicom_object_id
        AND o.dataset_id = ${args.datasetId}::uuid
        AND o.check_status = 'HELD'
        AND f.accepted_decision_id IS NULL
        AND f.attribute IN (${WHOLE_FILE})
        AND (f.attribute, f.value_digest) IN (${pairs})
      RETURNING f.attribute, f.value_digest
    )
    SELECT attribute, value_digest, count(*)::int AS instance_count
    FROM marked
    GROUP BY attribute, value_digest`);
}

/**
 * Release every held file of the dataset whose findings are ALL
 * accepted. Returns how many were released. A file with no finding row
 * is never released here: `HELD` without findings should not exist,
 * and if it does it was not reviewed.
 */
export async function releaseCoveredObjects(db: Db, datasetId: string): Promise<number> {
  const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    UPDATE catalog.dicom_objects o
    SET check_status = 'RELEASED'
    WHERE o.dataset_id = ${datasetId}::uuid
      AND o.check_status = 'HELD'
      AND EXISTS (SELECT 1 FROM catalog.dicom_findings f WHERE f.dicom_object_id = o.id)
      AND NOT EXISTS (
        SELECT 1 FROM catalog.dicom_findings f
        WHERE f.dicom_object_id = o.id AND NOT ${accepted('o', 'f')}
      )
    RETURNING o.id`);
  return rows.length;
}

export interface DecisionRow {
  id: string;
  reason: string;
  decided_at: Date;
  accepted_finding_count: number;
}

/** Decisions of a dataset, the latest first, with how many findings each accepted. */
export function listDecisions(db: Db, datasetId: string, limit: number): Promise<DecisionRow[]> {
  return db.$queryRaw<DecisionRow[]>(Prisma.sql`
    SELECT d.id, d.reason, d.decided_at,
      (
        (SELECT count(*) FROM catalog.dicom_accepted_findings a WHERE a.decision_id = d.id)
        + (
          SELECT count(DISTINCT (f.attribute, f.value_digest))
          FROM catalog.dicom_findings f WHERE f.accepted_decision_id = d.id
        )
      )::int AS accepted_finding_count
    FROM catalog.dicom_finding_decisions d
    WHERE d.dataset_id = ${datasetId}::uuid
    ORDER BY d.decided_at DESC, d.id
    LIMIT ${limit}`);
}
