import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  ArrowLeftIcon,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Container,
  Section,
} from '@oci/ui';
import type { EvaluationSubmissionDetail } from '@oci/shared-types';
import { apiFetch } from '../../../../lib/api';
import { Figure } from '../../../../components/evaluation/subgroup-results';
import { SUBGROUP_TEXT as T } from '../../../../components/evaluation/subgroup-text';
import {
  COMPARE_METRICS,
  compareTables,
  metricLabel,
  type CompareTable,
  type SubgroupMetricKey,
} from '../../../../components/evaluation/subgroup-table';

/**
 * Two results of one task, side by side, group by group (#410). The page a
 * facilitator puts on the screen to show that two models with the same overall
 * figure differ for one group of patients.
 *
 * Reads two submissions through the public detail endpoint, anonymously: only
 * scored results are compared, and those are public. A failed or unknown id is
 * "not found". Every figure here was already published on each submission's own
 * page, withheld groups withheld; this page computes only differences.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LINK =
  'rounded font-medium text-[var(--color-primary)] underline underline-offset-2 hover:text-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return {
    title: T.compare.metaTitle(slug),
    description: T.compare.metaDescription(slug),
    robots: { index: false, follow: false },
  };
}

export default async function CompareBySubgroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: SearchParams;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const a = one(query['a']) ?? '';
  const b = one(query['b']) ?? '';
  const taskHref = `/evaluation/${encodeURIComponent(slug)}` as const;

  if (!UUID.test(a) || !UUID.test(b) || a === b) {
    return <Message slug={slug} title={T.compare.pickTwo} />;
  }

  const load = (id: string) =>
    apiFetch<EvaluationSubmissionDetail>(
      `/v2/evaluation/tasks/${encodeURIComponent(slug)}/submissions/${id}`,
      { revalidate: 0 },
    );
  const [first, second] = await Promise.all([load(a), load(b)]);
  if (!first || !second) notFound();

  if (!first.scores || !second.scores || !first.subgroups || !second.subgroups) {
    return <Message slug={slug} title={T.compare.notComparable} />;
  }

  const kind = first.scores.kind;
  // `kind` is the parsed scores' discriminant, a closed literal union.
  // eslint-disable-next-line security/detect-object-injection
  const options = COMPARE_METRICS[kind];
  const requested = one(query['metric']);
  const metric: SubgroupMetricKey =
    options.find((o) => o === requested) ?? (options[0] as SubgroupMetricKey);
  const tables = compareTables(
    metric,
    { scores: first.scores, subgroups: first.subgroups },
    { scores: second.scores, subgroups: second.subgroups },
  );
  const hrefFor = (m: SubgroupMetricKey) =>
    `${taskHref}/compare?a=${a}&b=${b}&metric=${encodeURIComponent(m)}`;

  return (
    <>
      <Section spacing="md" surface="hero">
        <Container size="lg">
          <Link
            href={taskHref}
            className="inline-flex items-center gap-1.5 rounded text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
          >
            <ArrowLeftIcon size={14} />
            <span>{first.task.name}</span>
          </Link>
          <p className="mt-4 text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            {T.compare.eyebrow}
          </p>
          <h1 className="mt-2 break-words text-3xl font-semibold tracking-tight text-[var(--color-foreground)] sm:text-4xl">
            {T.compare.title(first.methodName, second.methodName)}
          </h1>
          <p className="mt-4 max-w-2xl text-[var(--color-muted-foreground)]">{T.compare.explain}</p>
        </Container>
      </Section>

      <Container size="lg">
        <Section spacing="md" className="space-y-8">
          <nav aria-label={T.compare.metricChoice} className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-[var(--color-muted-foreground)]">
              {T.compare.metricChoice}:
            </span>
            {options.map((m) => (
              <Link
                key={m}
                href={hrefFor(m)}
                aria-current={m === metric ? 'page' : undefined}
                className={
                  'rounded-full border px-3 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] ' +
                  (m === metric
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                    : 'border-[var(--color-border)] text-[var(--color-foreground)] hover:border-[var(--color-primary)]')
                }
              >
                {metricLabel(m)}
              </Link>
            ))}
          </nav>

          {tables.map((table) => (
            <CompareCard
              key={table.key}
              table={table}
              metric={metric}
              names={[first.methodName, second.methodName]}
            />
          ))}

          <div className="space-y-2 rounded-lg bg-[var(--color-subtle)] p-4 text-sm text-[var(--color-muted-foreground)]">
            <p className="font-medium text-[var(--color-foreground)]">{T.caution.title}</p>
            <p>{T.caution.body}</p>
            <p>{T.suppression.note(first.subgroups.minCellSize.toLocaleString('en-GB'))}</p>
          </div>

          <p className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Link href={`${taskHref}/submissions/${first.id}#subgroups`} className={LINK}>
              {first.methodName}
            </Link>
            <Link href={`${taskHref}/submissions/${second.id}#subgroups`} className={LINK}>
              {second.methodName}
            </Link>
            <Link href={taskHref} className={LINK}>
              {T.compare.back}
            </Link>
          </p>
        </Section>
      </Container>
    </>
  );
}

function CompareCard({
  table,
  metric,
  names,
}: {
  table: CompareTable;
  metric: SubgroupMetricKey;
  names: [string, string];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{T.section.byField(table.label)}</CardTitle>
        <CardDescription>{metricLabel(metric)}</CardDescription>
      </CardHeader>
      <CardContent>
        <div
          tabIndex={0}
          role="region"
          aria-label={`${T.section.tableLabel(table.label)}: ${metricLabel(metric)}`}
          className="overflow-x-auto rounded-lg border border-[var(--color-border)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
        >
          <table className="w-full border-collapse text-xs sm:text-sm">
            <thead className="bg-[var(--color-subtle)] text-[var(--color-muted-foreground)]">
              <tr>
                <th scope="col" className="px-1.5 py-2.5 text-start font-medium sm:px-4">
                  {T.section.groupColumn}
                </th>
                <th scope="col" className="break-words px-1.5 py-2.5 text-end font-medium sm:px-4">
                  {names[0]}
                </th>
                <th scope="col" className="break-words px-1.5 py-2.5 text-end font-medium sm:px-4">
                  {names[1]}
                </th>
                <th scope="col" className="px-1.5 py-2.5 text-end font-medium sm:px-4">
                  {T.compare.difference}
                  <span className="sr-only">
                    {' '}
                    ({T.compare.differenceSpoken(names[1], names[0])})
                  </span>
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
                  {row.kind === 'suppressed' || !row.a || !row.b ? (
                    <td
                      colSpan={3}
                      className="px-1.5 py-2.5 text-end text-[var(--color-muted-foreground)] sm:px-4"
                    >
                      <span aria-hidden="true">{T.suppression.notReported}</span>
                      <span className="sr-only">{T.suppression.notReportedSpoken(row.label)}</span>
                    </td>
                  ) : (
                    <>
                      <td className="px-1.5 py-2.5 text-end align-top tabular-nums sm:px-4">
                        <Figure cell={row.a} strong={row.kind === 'overall'} />
                      </td>
                      <td className="px-1.5 py-2.5 text-end align-top tabular-nums sm:px-4">
                        <Figure cell={row.b} strong={row.kind === 'overall'} />
                      </td>
                      <td
                        className={
                          'px-1.5 py-2.5 text-end align-top font-medium tabular-nums sm:px-4 ' +
                          (row.differenceValue !== null && row.differenceValue < 0
                            ? 'text-[var(--color-danger)]'
                            : 'text-[var(--color-foreground)]')
                        }
                      >
                        {row.difference ?? '—'}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function Message({ slug, title }: { slug: string; title: string }) {
  return (
    <Container size="md">
      <Section spacing="md">
        <Alert tone="info">
          <AlertTitle as="h1">{title}</AlertTitle>
          <AlertDescription>
            <Link href={`/evaluation/${encodeURIComponent(slug)}`} className={LINK}>
              {T.compare.back}
            </Link>
          </AlertDescription>
        </Alert>
      </Section>
    </Container>
  );
}
