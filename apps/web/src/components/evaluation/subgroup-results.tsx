import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@oci/ui';
import type { SubgroupResults, TaskKindScores } from '@oci/shared-types';
import type { EvaluationI18n } from './i18n';
import { getEvaluationI18n } from './server-i18n';
import { subgroupTables, type FigureCell, type SubgroupTable } from './subgroup-table';

/**
 * "Results by subgroup" on a submission's page (#410): one table per declared
 * field, the whole-set row first so each group reads against it. Withheld
 * groups and rates are said to be withheld, in words, never left blank.
 *
 * Laid out for 375 px: at most five columns, small type on a phone, and the
 * table region scrolls (and takes focus) if a long group label still makes it
 * overflow.
 *
 * Worded in the request's language (#654); the field and group labels are
 * the task's own, from the API.
 */
export async function SubgroupResultsCard({
  subgroups,
  scores,
}: {
  subgroups: SubgroupResults;
  scores: TaskKindScores;
}) {
  const i18n = await getEvaluationI18n();
  const { t, f } = i18n;
  const tables = subgroupTables(i18n, subgroups, scores);
  const hasIntervals = scores.kind === 'BINARY_DIAGNOSTIC';
  return (
    <Card id="subgroups" className="scroll-mt-24">
      <CardHeader>
        <CardTitle as="h2">{t('subgroup.section.title')}</CardTitle>
        <CardDescription>{t('subgroup.section.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        {tables.map((table) => (
          <FieldTable key={table.key} table={table} i18n={i18n} />
        ))}
        <div className="space-y-2 rounded-lg bg-[var(--color-subtle)] p-4 text-sm text-[var(--color-muted-foreground)]">
          <p className="font-medium text-[var(--color-foreground)]">
            {t('subgroup.caution.title')}
          </p>
          <p>{t('subgroup.caution.body')}</p>
          {hasIntervals ? <p>{t('subgroup.caution.intervals')}</p> : null}
          <p>{t('subgroup.suppression.note', { min: f.number(subgroups.minCellSize) })}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function FieldTable({ table, i18n }: { table: SubgroupTable; i18n: EvaluationI18n }) {
  const { t } = i18n;
  const span = table.columns.length + 1;
  const field = table.label.toLowerCase();
  return (
    <section aria-labelledby={`subgroup-${table.key}`} className="space-y-3">
      <h3
        id={`subgroup-${table.key}`}
        className="text-base font-semibold text-[var(--color-foreground)]"
      >
        {t('subgroup.section.byField', { field })}
      </h3>
      <div
        tabIndex={0}
        role="region"
        aria-label={t('subgroup.section.tableLabel', { field })}
        className="overflow-x-auto rounded-lg border border-[var(--color-border)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
      >
        <table className="w-full border-collapse text-xs sm:text-sm">
          <thead className="bg-[var(--color-subtle)] text-[var(--color-muted-foreground)]">
            <tr>
              <th scope="col" className="px-1.5 py-2.5 text-start font-medium sm:px-4">
                {t('subgroup.section.groupColumn')}
              </th>
              {table.columns.map((c) => (
                <th key={c.key} scope="col" className="px-1.5 py-2.5 text-end font-medium sm:px-4">
                  {c.label}
                </th>
              ))}
              <th scope="col" className="px-1.5 py-2.5 text-end font-medium sm:px-4">
                {t('subgroup.section.itemsColumn')}
              </th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr
                key={row.key}
                className={
                  'border-t border-[var(--color-border)] ' +
                  (row.kind === 'overall' ? 'bg-[var(--color-subtle)]/60' : '')
                }
              >
                <th
                  scope="row"
                  className={
                    'px-1.5 py-2.5 text-start sm:px-4 ' +
                    (row.kind === 'overall' ? 'font-semibold' : 'font-medium')
                  }
                >
                  {row.label}
                </th>
                {row.kind === 'suppressed' ? (
                  <td
                    colSpan={span}
                    className="px-1.5 py-2.5 text-end text-[var(--color-muted-foreground)] sm:px-4"
                  >
                    <span aria-hidden="true">{t('subgroup.suppression.notReported')}</span>
                    <span className="sr-only">
                      {t('subgroup.suppression.notReportedSpoken', { group: row.label })}
                    </span>
                  </td>
                ) : (
                  <>
                    {row.cells.map((cell, i) => (
                      <td key={i} className="px-1.5 py-2.5 text-end align-top tabular-nums sm:px-4">
                        <Figure cell={cell} strong={row.kind === 'overall'} />
                      </td>
                    ))}
                    <td className="px-1.5 py-2.5 text-end align-top tabular-nums text-[var(--color-muted-foreground)] sm:px-4">
                      {row.items ?? '—'}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** One figure; a withheld or not-estimable one says so to a screen reader. */
export function Figure({ cell, strong }: { cell: FigureCell; strong?: boolean }) {
  if (cell.state !== 'value') {
    return (
      <span className="text-[var(--color-muted-foreground)]">
        <span aria-hidden="true">{cell.text}</span>
        <span className="sr-only">{cell.spoken}</span>
      </span>
    );
  }
  return (
    <>
      <span
        aria-hidden={cell.spoken ? true : undefined}
        className={
          'block text-[var(--color-foreground)] ' + (strong ? 'font-semibold' : 'font-medium')
        }
      >
        {cell.text}
      </span>
      {cell.interval ? (
        <span
          aria-hidden="true"
          className="block text-[0.7rem] text-[var(--color-muted-foreground)] sm:text-xs"
        >
          {cell.interval}
        </span>
      ) : null}
      {cell.spoken ? <span className="sr-only">{cell.spoken}</span> : null}
    </>
  );
}
