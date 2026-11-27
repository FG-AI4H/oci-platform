import type { Metadata } from 'next';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Container,
  Field,
  Input,
  Section,
} from '@oci/ui';
import {
  EvaluationTaskKindDbSchema,
  IntendedUseCategorySchema,
  UseCaseQuerySchema,
  type AccessRequestMatchStatus,
  type UseCaseQuery,
  type UseCaseSuggestionsResponse,
} from '@oci/shared-types';
import { auth } from '../../auth';
import { zodParseParams } from '../../i18n/zod';
import { apiFetch } from '../../lib/api';

/**
 * `/use-case` (#829): from a described use case to the datasets, the
 * evaluation tasks and the models that fit it.
 *
 * A plain GET form: the answers live in the address, so a use case can be
 * bookmarked, sent to a colleague, and carried into an access request. The
 * API does the matching (`GET /v2/use-case/suggestions`); this page only
 * asks and lays the answer out. Public, like the catalogue; a signed-in
 * visitor also gets the datasets their account may see.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('UseCase');
  return { title: t('metaTitle'), description: t('metaDescription') };
}

const FIELDS = ['q', 'modality', 'taskKind', 'intendedUse', 'irbApproved', 'country'] as const;
type FieldName = (typeof FIELDS)[number];
type SearchParams = Partial<Record<FieldName, string | string[]>>;

/** Modality labels offered as suggestions; any other text is accepted. */
const MODALITY_HINTS = [
  'CT',
  'MRI',
  'X-ray',
  'Ultrasound',
  'Fundus photography',
  'Dermoscopy',
  'Histopathology',
  'ECG',
  'Text',
];

const MATCH_TONE: Record<AccessRequestMatchStatus, 'success' | 'warning' | 'danger'> = {
  MATCHED: 'success',
  UNCLEAR: 'warning',
  CONFLICT: 'danger',
};

const SELECT_CLASS =
  'block h-10 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-base sm:text-sm text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]';

const LINK_CLASS =
  'font-medium text-[var(--color-primary)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded';

/** The first value of each known field, as typed. */
function answersFrom(params: SearchParams): Partial<Record<FieldName, string>> {
  const out: Partial<Record<FieldName, string>> = {};
  for (const field of FIELDS) {
    // eslint-disable-next-line security/detect-object-injection -- closed key set
    const raw = params[field];
    const value = Array.isArray(raw) ? raw[0] : raw;
    // eslint-disable-next-line security/detect-object-injection -- closed key set
    if (typeof value === 'string') out[field] = value;
  }
  return out;
}

/** The use case as a query string: the API call, and the address to keep. */
function queryOf(useCase: UseCaseQuery): string {
  const qs = new URLSearchParams();
  if (useCase.q) qs.set('q', useCase.q);
  if (useCase.modality) qs.set('modality', useCase.modality);
  if (useCase.taskKind) qs.set('taskKind', useCase.taskKind);
  qs.set('intendedUse', useCase.intendedUse);
  if (useCase.irbApproved) qs.set('irbApproved', 'true');
  if (useCase.country) qs.set('country', useCase.country);
  return qs.toString();
}

export default async function UseCasePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const answers = answersFrom(await searchParams);
  const asked = Object.keys(answers).length > 0;
  const [t, tAccess, tEval, session, locale] = await Promise.all([
    getTranslations('UseCase'),
    getTranslations('AccessRequest'),
    getTranslations('Evaluation'),
    auth(),
    getLocale(),
  ]);

  const parsed = asked ? UseCaseQuerySchema.safeParse(answers, zodParseParams(locale)) : null;
  const useCase = parsed?.success ? parsed.data : null;

  let suggestions: UseCaseSuggestionsResponse | null = null;
  let error: string | null = null;
  if (useCase) {
    try {
      suggestions = await apiFetch<UseCaseSuggestionsResponse>(
        `/v2/use-case/suggestions?${queryOf(useCase)}`,
        session?.user ? { session, revalidate: 0 } : {},
      );
    } catch (err) {
      error = err instanceof Error ? err.message : t('unavailable.fallback');
    }
  }

  const taskKindLabel = (kind: string) =>
    tEval(`taskKind.${kind as (typeof EvaluationTaskKindDbSchema.options)[number]}`);

  return (
    <Container size="page">
      <Section spacing="md">
        <header className="mb-8 max-w-3xl space-y-3">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            {t('eyebrow')}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t('heading')}</h1>
          <p className="text-[var(--color-muted-foreground)]">{t('lead')}</p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle as="h2">{t('form.legend')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form action="/use-case" method="get" className="space-y-5">
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                <Field label={t('form.q.label')} htmlFor="uc-q" hint={t('form.q.hint')}>
                  <Input id="uc-q" name="q" defaultValue={answers.q ?? ''} maxLength={200} />
                </Field>
                <Field
                  label={t('form.modality.label')}
                  htmlFor="uc-modality"
                  hint={t('form.modality.hint')}
                >
                  <Input
                    id="uc-modality"
                    name="modality"
                    list="uc-modality-hints"
                    defaultValue={answers.modality ?? ''}
                    maxLength={100}
                    autoComplete="off"
                  />
                </Field>
                <Field label={t('form.taskKind.label')} htmlFor="uc-taskKind">
                  <select
                    id="uc-taskKind"
                    name="taskKind"
                    defaultValue={answers.taskKind ?? ''}
                    className={SELECT_CLASS}
                  >
                    <option value="">{t('form.taskKind.any')}</option>
                    {EvaluationTaskKindDbSchema.options.map((kind) => (
                      <option key={kind} value={kind}>
                        {taskKindLabel(kind)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t('form.intendedUse.label')} htmlFor="uc-intendedUse">
                  <select
                    id="uc-intendedUse"
                    name="intendedUse"
                    defaultValue={answers.intendedUse ?? 'NON_COMMERCIAL_RESEARCH'}
                    className={SELECT_CLASS}
                  >
                    {IntendedUseCategorySchema.options.map((use) => (
                      <option key={use} value={use}>
                        {tAccess(`form.intendedUse.option.${use}.label`)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label={t('form.country.label')}
                  htmlFor="uc-country"
                  hint={t('form.country.hint')}
                >
                  <Input
                    id="uc-country"
                    name="country"
                    defaultValue={answers.country ?? ''}
                    maxLength={64}
                  />
                </Field>
              </div>
              <datalist id="uc-modality-hints">
                {MODALITY_HINTS.map((label) => (
                  <option key={label} value={label} />
                ))}
              </datalist>
              <label className="flex min-h-11 items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  name="irbApproved"
                  value="true"
                  defaultChecked={answers.irbApproved === 'true'}
                  className="mt-1 size-4 shrink-0 accent-[var(--color-primary)]"
                />
                <span>
                  <span className="font-medium">{t('form.irbApproved.label')}</span>{' '}
                  <span className="text-[var(--color-muted-foreground)]">
                    {t('form.irbApproved.hint')}
                  </span>
                </span>
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" size="lg">
                  {t('form.submit')}
                </Button>
                {asked ? (
                  <Link href="/use-case" className={`${LINK_CLASS} text-sm`}>
                    {t('form.reset')}
                  </Link>
                ) : null}
              </div>
            </form>
          </CardContent>
        </Card>

        {parsed && !parsed.success ? (
          <Alert tone="danger" className="mt-8">
            <AlertTitle>{t('invalid.title')}</AlertTitle>
            <AlertDescription>
              <p>{t('invalid.body')}</p>
              <ul className="ms-4 mt-2 list-disc space-y-1 text-sm">
                {parsed.error.issues.map((issue, i) => {
                  const field = FIELDS.find((f) => f === issue.path[0]);
                  return (
                    <li key={i}>
                      {field ? `${t(`form.${field}.label`)}: ` : null}
                      {issue.message}
                    </li>
                  );
                })}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert tone="danger" className="mt-8">
            <AlertTitle>{t('unavailable.title')}</AlertTitle>
            <AlertDescription>
              <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs">{error}</pre>
            </AlertDescription>
          </Alert>
        ) : null}

        {!asked ? (
          <section aria-labelledby="uc-intro" className="mt-10 max-w-3xl">
            <h2 id="uc-intro" className="text-lg font-semibold">
              {t('intro.title')}
            </h2>
            <ol className="ms-5 mt-3 list-decimal space-y-2 text-[var(--color-muted-foreground)]">
              <li>{t('intro.datasets')}</li>
              <li>{t('intro.check')}</li>
              <li>{t('intro.tasks')}</li>
              <li>{t('intro.models')}</li>
            </ol>
          </section>
        ) : null}

        {useCase && suggestions ? (
          <div className="mt-10 space-y-12">
            <section aria-labelledby="uc-datasets">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 id="uc-datasets" className="text-xl font-semibold tracking-tight">
                  {t('datasets.heading')}
                </h2>
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  {t('datasets.count', { count: suggestions.datasets.length })}
                </p>
              </div>
              {suggestions.datasets.length === 0 ? (
                <p className="mt-3 text-[var(--color-muted-foreground)]">{t('datasets.empty')}</p>
              ) : (
                <>
                  <p className="mt-2 max-w-3xl text-sm text-[var(--color-muted-foreground)]">
                    {t('datasets.note')}
                  </p>
                  <ul className="mt-4 divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]">
                    {suggestions.datasets.map((d) => (
                      <li
                        key={d.slug}
                        className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
                      >
                        <div className="min-w-0 space-y-1.5">
                          <Link
                            href={`/catalog/${encodeURIComponent(d.slug)}`}
                            className={`${LINK_CLASS} break-words`}
                          >
                            {d.name}
                          </Link>
                          {d.description ? (
                            <p className="line-clamp-2 text-sm text-[var(--color-muted-foreground)]">
                              {d.description}
                            </p>
                          ) : null}
                          <div className="flex flex-wrap gap-2">
                            <Badge tone={MATCH_TONE[d.match]}>{t(`match.${d.match}`)}</Badge>
                            {d.requiresRequest ? (
                              <Badge tone="neutral">{t('datasets.restricted')}</Badge>
                            ) : null}
                            {d.modalities.map((m) => (
                              <Badge key={m} tone="neutral">
                                {m}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        {d.requiresRequest ? (
                          <Button asChild variant="outline" size="sm" className="shrink-0">
                            <Link
                              href={`/catalog/${encodeURIComponent(d.slug)}/request-access?intendedUse=${useCase.intendedUse}${useCase.irbApproved ? '&irbApproved=true' : ''}`}
                              aria-label={t('datasets.requestAria', { name: d.name })}
                            >
                              {t('datasets.request')}
                            </Link>
                          </Button>
                        ) : (
                          <Button asChild variant="outline" size="sm" className="shrink-0">
                            <Link
                              href={`/catalog/${encodeURIComponent(d.slug)}`}
                              aria-label={t('datasets.openAria', { name: d.name })}
                            >
                              {t('datasets.open')}
                            </Link>
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            <section aria-labelledby="uc-tasks">
              <h2 id="uc-tasks" className="text-xl font-semibold tracking-tight">
                {t('tasks.heading')}
              </h2>
              {suggestions.tasks.length === 0 ? (
                <p className="mt-3 text-[var(--color-muted-foreground)]">{t('tasks.empty')}</p>
              ) : (
                <ul className="mt-4 divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]">
                  {suggestions.tasks.map((task) => (
                    <li key={task.slug} className="space-y-1.5 p-4">
                      <Link
                        href={`/evaluation/${encodeURIComponent(task.slug)}`}
                        className={`${LINK_CLASS} break-words`}
                      >
                        {task.name}
                      </Link>
                      <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
                        <Badge tone="neutral">{taskKindLabel(task.taskKind)}</Badge>
                        <span className="break-all">
                          {t('tasks.onDataset', { dataset: task.datasetSlug })}
                        </span>
                        {task.onSuggestedDataset ? (
                          <Badge tone="primary">{t('tasks.suggested')}</Badge>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="uc-models">
              <h2 id="uc-models" className="text-xl font-semibold tracking-tight">
                {t('models.heading')}
              </h2>
              {suggestions.models.length === 0 ? (
                <p className="mt-3 text-[var(--color-muted-foreground)]">
                  {useCase.q || useCase.country ? t('models.empty') : t('models.needWords')}
                </p>
              ) : (
                <ul className="mt-4 divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]">
                  {suggestions.models.map((model) => (
                    <li
                      key={model.slug}
                      className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
                    >
                      <div className="min-w-0 space-y-1">
                        <Link
                          href={`/models/${encodeURIComponent(model.slug)}`}
                          className={`${LINK_CLASS} break-words`}
                        >
                          {model.slug}
                        </Link>
                        {model.modelDeveloper ? (
                          <p className="text-sm text-[var(--color-muted-foreground)]">
                            {model.modelDeveloper}
                          </p>
                        ) : null}
                        {model.clinicalSummary ? (
                          <p className="line-clamp-2 text-sm">{model.clinicalSummary}</p>
                        ) : null}
                      </div>
                      <Badge tone="info" className="shrink-0 self-start">
                        {t('models.riskTier', { tier: model.riskTier })}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section
              aria-labelledby="uc-keep"
              className="max-w-3xl rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-4"
            >
              <h2 id="uc-keep" className="text-sm font-semibold">
                {t('keep.title')}
              </h2>
              <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{t('keep.body')}</p>
              <Link
                href={`/use-case?${queryOf(useCase)}`}
                className={`${LINK_CLASS} mt-2 inline-block text-sm`}
              >
                {t('keep.link')}
              </Link>
            </section>
          </div>
        ) : null}
      </Section>
    </Container>
  );
}
