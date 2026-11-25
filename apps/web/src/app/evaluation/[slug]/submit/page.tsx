import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
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
import type { Session } from 'next-auth';
import { auth } from '../../../../auth';
import type { EvaluationI18n } from '../../../../components/evaluation/i18n';
import { positiveClassOf } from '../../../../components/evaluation/metrics';
import { describeQuota } from '../../../../components/evaluation/quota-text';
import {
  modelCardOptions,
  type ModelCardOption,
} from '../../../../components/evaluation/model-card-choice';
import { getEvaluationI18n } from '../../../../components/evaluation/server-i18n';
import { ApiError, apiFetch } from '../../../../lib/api';
import { myModelCards } from '../../../../lib/model-card-viewer';
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
 *
 * A signed-in reader may link the result to one of their model cards (#587).
 * The list is read here, with their session, and only the cards reach the
 * form.
 *
 * Text in the interface language (#654): `EvaluationTasks.submitPage`, the
 * form's own `EvaluationSubmit`, and the shared `Evaluation` vocabulary. The
 * example file keeps its column names (`item_id,label`): they are what the
 * platform reads.
 */

const LINK =
  'rounded font-medium text-[var(--color-primary)] underline underline-offset-2 hover:text-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const [{ slug }, t] = await Promise.all([params, getTranslations('EvaluationTasks')]);
  return {
    title: t('submitPage.metaTitle', { slug }),
    description: t('submitPage.metaDescription', { slug }),
    // A form, not content: nothing here for a crawler.
    robots: { index: false, follow: false },
  };
}

/** What the signed-in reader may do, without the token leaving the server. */
async function scoringAccess(
  session: Session | null,
  slug: string,
  i18n: EvaluationI18n,
): Promise<ScoringAccess> {
  if (!session?.user) return { kind: 'signed-out' };
  try {
    const quota = await apiFetch<ScoredSubmissionQuotaSummary>(
      `/v2/evaluation/tasks/${encodeURIComponent(slug)}/quota`,
      { session, revalidate: 0 },
    );
    return quota ? { kind: 'ready', quota: describeQuota(i18n, quota) } : { kind: 'unknown' };
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
  const [t, i18n] = await Promise.all([getTranslations('EvaluationTasks'), getEvaluationI18n()]);
  const { f } = i18n;

  let task: EvaluationTaskDetail | null = null;
  let error: string | null = null;
  try {
    task = await apiFetch<EvaluationTaskDetail>(
      `/v2/evaluation/tasks/${encodeURIComponent(slug)}`,
      { revalidate: 0 },
    );
  } catch (err) {
    error = err instanceof Error ? err.message : i18n.t('unavailable.fallback');
  }

  if (error) {
    return (
      <Container size="md">
        <Section spacing="md">
          <Alert tone="danger">
            <AlertTitle as="h1">{i18n.t('unavailable.title')}</AlertTitle>
            <AlertDescription>
              <pre className="mt-1 whitespace-pre-wrap break-words text-xs font-mono">{error}</pre>
            </AlertDescription>
          </Alert>
        </Section>
      </Container>
    );
  }
  if (!task) notFound();

  const session = await auth();
  const [access, mine] = await Promise.all([
    scoringAccess(session, task.slug, i18n),
    myModelCards(session),
  ]);
  const modelCards: ModelCardOption[] | null = mine ? modelCardOptions(mine.items) : null;
  const taskHref = `/evaluation/${encodeURIComponent(task.slug)}` as const;
  const templateHref = `${taskHref}/template.csv`;
  const topLabel = task.numClasses - 1;
  // Two real identifiers make the example recognisable next to the template.
  const exampleIds = task.itemIds.slice(0, 2);
  const isBinary = task.taskKind === 'BINARY_DIAGNOSTIC';
  const itemsText = t('submitPage.items', { count: task.itemCount, n: f.number(task.itemCount) });
  // A binary task's example shows the optional score column filled in. The
  // file itself is not translated: these are the columns the platform reads.
  const exampleLines = isBinary
    ? [
        'item_id,label,score',
        ...exampleIds.map((id, i) => `${id},${i % 2},${i % 2 ? '0.83' : '0.12'}`),
      ]
    : ['item_id,label', ...exampleIds.map((id, i) => `${id},${Math.min(i, topLabel)}`)];
  const stepLabel = (step: number) => t('submitPage.step', { step });

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
            {t('submitPage.eyebrow')}
          </p>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
            {t('submitPage.heading')}
          </h1>
          <p className="max-w-prose text-[var(--color-muted-foreground)]">{t('submitPage.lead')}</p>
        </header>

        {task.itemCount === 0 ? (
          <Alert tone="warning">
            <AlertTitle as="h2">{t('submitPage.noItemsTitle')}</AlertTitle>
            <AlertDescription>{t('submitPage.noItemsBody')}</AlertDescription>
          </Alert>
        ) : (
          <ol className="space-y-6">
            <li>
              <Card>
                <CardHeader>
                  <StepTitle step={1} label={stepLabel(1)}>
                    {t('submitPage.step1Title')}
                  </StepTitle>
                  <CardDescription>
                    {isBinary
                      ? i18n.t('binary.submit.templateDescription', { items: itemsText })
                      : t('submitPage.step1Description', { items: itemsText })}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* A plain link: the route answers with a file, not a page. */}
                  <a href={templateHref} download className={buttonVariants({ size: 'lg' })}>
                    <DownloadIcon size={18} />
                    {t('submitPage.download')}
                  </a>
                  <p className="text-sm text-[var(--color-muted-foreground)]">
                    {t.rich('submitPage.semicolon', {
                      link: (chunks) => (
                        <a href={`${templateHref}?sep=semicolon`} download className={LINK}>
                          {chunks}
                        </a>
                      ),
                    })}
                  </p>
                </CardContent>
              </Card>
            </li>

            <li>
              <Card>
                <CardHeader>
                  <StepTitle step={2} label={stepLabel(2)}>
                    {t('submitPage.step2Title')}
                  </StepTitle>
                  <CardDescription>
                    {isBinary ? (
                      i18n.t('binary.submit.fillIn', { positive: positiveClassOf(i18n, task) })
                    ) : (
                      <>
                        {t.rich('submitPage.fillIn', {
                          top: f.number(topLabel),
                          code: (chunks) => <code className="font-mono text-xs">{chunks}</code>,
                        })}{' '}
                        {task.taskKind === 'GRADING'
                          ? t('submitPage.fillGrading', {
                              threshold: f.number(task.referableThreshold),
                            })
                          : t('submitPage.fillClasses', { n: f.number(task.numClasses) })}
                      </>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* The optional score is its own paragraph, so the one thing
                      everyone must do (the label) is not buried under it. */}
                  {isBinary ? (
                    <p className="max-w-prose text-sm text-[var(--color-muted-foreground)]">
                      {i18n.t('binary.submit.scoreHint')}
                    </p>
                  ) : null}
                  <pre
                    aria-label={t('submitPage.exampleLabel')}
                    className="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-subtle)] p-4 font-mono text-xs text-[var(--color-foreground)]"
                  >
                    {[...exampleLines, '…'].join('\n')}
                  </pre>
                  <ul className="list-disc space-y-1 ps-5 text-sm text-[var(--color-muted-foreground)]">
                    <li>{t('submitPage.keepIds')}</li>
                    <li>{t('submitPage.leaveOut')}</li>
                    <li>{t('submitPage.saveCsv')}</li>
                  </ul>
                </CardContent>
              </Card>
            </li>

            <li>
              <Card accent="primary">
                <CardHeader>
                  <StepTitle step={3} label={stepLabel(3)}>
                    {t('submitPage.step3Title')}
                  </StepTitle>
                  <CardDescription>{t('submitPage.step3Description')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <SubmitPredictionsForm slug={task.slug} access={access} modelCards={modelCards} />
                </CardContent>
              </Card>
            </li>
          </ol>
        )}
      </Section>
    </Container>
  );
}

function StepTitle({
  step,
  label,
  children,
}: {
  step: number;
  /** "Step 1: ", read before the title by a screen reader. */
  label: string;
  children: string;
}) {
  return (
    <CardTitle as="h2" className="flex items-baseline gap-3">
      <span
        aria-hidden="true"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center self-center rounded-full bg-[var(--color-primary-soft)] text-sm font-semibold tabular-nums text-[var(--color-primary)]"
      >
        {step}
      </span>
      <span>
        <span className="sr-only">{label}</span>
        {children}
      </span>
    </CardTitle>
  );
}
