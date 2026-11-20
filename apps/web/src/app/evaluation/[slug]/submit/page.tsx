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
  DownloadIcon,
  Section,
  buttonVariants,
} from '@oci/ui';
import type { EvaluationTaskDetail, ScoredSubmissionQuotaSummary } from '@oci/shared-types';
import { auth } from '../../../../auth';
import { describeQuota } from '../../../../components/evaluation/quota-text';
import { ApiError, apiFetch } from '../../../../lib/api';
import { SubmitPredictionsForm, type ScoringAccess } from './submit-form';

/**
 * Submit a predictions file to an evaluation task from the browser (#645).
 *
 * Open to everyone: downloading the template and checking a file's format need
 * no account, exactly like the API's validation path they call. Only "Submit
 * for scoring" needs a session, and the form shows a sign-in link in its place
 * to a signed-out reader.
 *
 * The page is three numbered steps in reading order — get the template, fill
 * it in, check and submit — because the reader is expected to be doing this
 * for the first time.
 */

const LINK =
  'rounded font-medium text-[var(--color-primary)] underline underline-offset-2 hover:text-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return {
    title: `Submit predictions — ${slug} — OCI Evaluation`,
    description: `Check and submit a predictions file for the ${slug} evaluation task.`,
    // A form, not content: nothing here for a crawler.
    robots: { index: false, follow: false },
  };
}

/** What the signed-in reader may do, without the token leaving the server. */
async function scoringAccess(slug: string): Promise<ScoringAccess> {
  const session = await auth();
  if (!session?.accessToken) return { kind: 'signed-out' };
  try {
    const quota = await apiFetch<ScoredSubmissionQuotaSummary>(
      `/v2/evaluation/tasks/${encodeURIComponent(slug)}/quota`,
      { session, revalidate: 0 },
    );
    return quota ? { kind: 'ready', quota: describeQuota(quota) } : { kind: 'unknown' };
  } catch (err) {
    return err instanceof ApiError && err.status === 401
      ? { kind: 'expired' }
      : { kind: 'unknown' };
  }
}

export default async function SubmitPredictionsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let task: EvaluationTaskDetail | null = null;
  let error: string | null = null;
  try {
    task = await apiFetch<EvaluationTaskDetail>(
      `/v2/evaluation/tasks/${encodeURIComponent(slug)}`,
      { revalidate: 0 },
    );
  } catch (err) {
    error = err instanceof Error ? err.message : 'Unable to reach evaluation API';
  }

  if (error) {
    return (
      <Container size="md">
        <Section spacing="md">
          <Alert tone="danger">
            <AlertTitle as="h1">Evaluation unavailable</AlertTitle>
            <AlertDescription>
              <pre className="mt-1 whitespace-pre-wrap break-words text-xs font-mono">{error}</pre>
            </AlertDescription>
          </Alert>
        </Section>
      </Container>
    );
  }
  if (!task) notFound();

  const access = await scoringAccess(task.slug);
  const taskHref = `/evaluation/${encodeURIComponent(task.slug)}` as const;
  const templateHref = `${taskHref}/template.csv`;
  const topLabel = task.numClasses - 1;
  const n = (value: number) => value.toLocaleString('en-GB');
  // Two real identifiers make the example recognisable next to the template.
  const exampleIds = task.itemIds.slice(0, 2);

  return (
    <Container size="md">
      <Section spacing="md" className="space-y-8">
        <header className="space-y-3">
          <Link
            href={taskHref}
            className="inline-flex items-center gap-1.5 rounded text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
          >
            <ArrowLeftIcon size={14} />
            <span>{task.name}</span>
          </Link>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            Evaluation
          </p>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Submit predictions</h1>
          <p className="max-w-prose text-[var(--color-muted-foreground)]">
            Send one label per item and get the metrics back. The file is compared with reference
            labels the platform holds; those labels are never shown, to you or to anyone else.
          </p>
        </header>

        {task.itemCount === 0 ? (
          <Alert tone="warning">
            <AlertTitle as="h2">This task has no items yet</AlertTitle>
            <AlertDescription>
              There is nothing to predict until its host adds them.
            </AlertDescription>
          </Alert>
        ) : (
          <ol className="space-y-6">
            <li>
              <Card>
                <CardHeader>
                  <StepTitle step={1}>Get the template</StepTitle>
                  <CardDescription>
                    A spreadsheet file with one line for each of the {n(task.itemCount)}{' '}
                    {task.itemCount === 1 ? 'item' : 'items'} in this task, and an empty column for
                    your labels.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* A plain link: the route answers with a file, not a page. */}
                  <a href={templateHref} download className={buttonVariants({ size: 'lg' })}>
                    <DownloadIcon size={18} />
                    Download template
                  </a>
                  <p className="text-sm text-[var(--color-muted-foreground)]">
                    If the file opens with everything in one column, your spreadsheet expects
                    semicolons, as it does wherever decimals are written with a comma. Use the{' '}
                    <a href={`${templateHref}?sep=semicolon`} download className={LINK}>
                      semicolon-separated template
                    </a>{' '}
                    instead. Both are accepted.
                  </p>
                </CardContent>
              </Card>
            </li>

            <li>
              <Card>
                <CardHeader>
                  <StepTitle step={2}>Fill in the labels</StepTitle>
                  <CardDescription>
                    In the <code className="font-mono text-xs">label</code> column, type a whole
                    number from 0 to {n(topLabel)} for each item.{' '}
                    {task.taskKind === 'GRADING' ? (
                      <>
                        The number is the grade; {n(task.referableThreshold)} or more counts as
                        referable.
                      </>
                    ) : (
                      <>Each number stands for one of the {n(task.numClasses)} classes.</>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <pre
                    aria-label="Example of a filled-in file"
                    className="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-subtle)] p-4 font-mono text-xs text-[var(--color-foreground)]"
                  >
                    {[
                      'item_id,label',
                      ...exampleIds.map((id, i) => `${id},${Math.min(i, topLabel)}`),
                      '…',
                    ].join('\n')}
                  </pre>
                  <ul className="list-disc space-y-1 ps-5 text-sm text-[var(--color-muted-foreground)]">
                    <li>Do not change the identifiers or the first line.</li>
                    <li>
                      To leave an item out, delete its line. It is then not scored, and the result
                      shows lower coverage.
                    </li>
                    <li>Save the file as CSV, not as a spreadsheet workbook.</li>
                  </ul>
                </CardContent>
              </Card>
            </li>

            <li>
              <Card accent="primary">
                <CardHeader>
                  <StepTitle step={3}>Check the format, then submit</StepTitle>
                  <CardDescription>
                    Checking is free and can be repeated as often as you like: it reads the file and
                    tells you what to correct, without scoring it. Submitting for scoring is
                    limited, so check first.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <SubmitPredictionsForm slug={task.slug} access={access} />
                </CardContent>
              </Card>
            </li>
          </ol>
        )}
      </Section>
    </Container>
  );
}

function StepTitle({ step, children }: { step: number; children: string }) {
  return (
    <CardTitle as="h2" className="flex items-baseline gap-3">
      <span
        aria-hidden="true"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center self-center rounded-full bg-[var(--color-primary-soft)] text-sm font-semibold tabular-nums text-[var(--color-primary)]"
      >
        {step}
      </span>
      <span>
        <span className="sr-only">Step {step}: </span>
        {children}
      </span>
    </CardTitle>
  );
}
