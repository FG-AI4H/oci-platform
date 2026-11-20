import type { PrismaClient } from '@oci/database';

/**
 * Test support: a snapshot of every row of the application schemas, for
 * specs that must prove a script changed NOTHING (a seed replayed twice, a
 * dry run) or changed only what it was scoped to (a reset).
 *
 * Raw SQL on purpose, and confined to this file: the snapshot reads every
 * table generically and needs the row's `xmin`, the id of the transaction
 * that last wrote it, which no model exposes. Comparing `xmin` as well as
 * the content is what catches an UPDATE that rewrites a row with the values
 * it already had. Table names come from `information_schema`, never from a
 * caller.
 */

export const APPLICATION_SCHEMAS = [
  'identity',
  'catalog',
  'annotation',
  'evaluation',
  'prediction',
  'reporting',
  'platform',
] as const;

export interface RowSnapshot {
  /** `schema.table`. */
  table: string;
  /** Transaction that last wrote the row. */
  xmin: string;
  row: Record<string, unknown>;
}

export async function snapshotTables(prisma: PrismaClient): Promise<RowSnapshot[]> {
  const tables = await prisma.$queryRawUnsafe<{ table_schema: string; table_name: string }[]>(
    `SELECT table_schema, table_name FROM information_schema.tables
     WHERE table_type = 'BASE TABLE' AND table_schema = ANY($1::text[])
     ORDER BY table_schema, table_name`,
    [...APPLICATION_SCHEMAS],
  );
  const snapshot: RowSnapshot[] = [];
  for (const { table_schema: schema, table_name: name } of tables) {
    const rows = await prisma.$queryRawUnsafe<{ xmin: string; row: Record<string, unknown> }[]>(
      `SELECT t.xmin::text AS xmin, to_jsonb(t) AS row FROM "${schema}"."${name}" t`,
    );
    for (const { xmin, row } of rows) snapshot.push({ table: `${schema}.${name}`, xmin, row });
  }
  return snapshot;
}

/** Stable text form of a snapshot, one line per row, for an equality assertion with a readable diff. */
export function snapshotLines(snapshot: readonly RowSnapshot[]): string[] {
  return snapshot.map((s) => `${s.table} xmin=${s.xmin} ${JSON.stringify(s.row)}`).sort();
}
