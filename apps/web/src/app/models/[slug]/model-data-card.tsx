import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Badge, Card, CardContent, CardHeader, CardTitle, ExternalLinkIcon } from '@oci/ui';
import type {
  ModelCardDatasetFacts,
  ModelCardDatasetRef,
  ModelCardEvaluatedOn,
} from '@oci/shared-types';

/**
 * The datasets behind a model (#820), in two groups that must not be
 * confused: what the developer declares (training, tuning, validation,
 * evaluation), and what this platform measured, read from the published
 * results linked to the card.
 *
 * The API has already applied the catalogue's visibility rule: a dataset the
 * reader may not see arrives as `WITHHELD`, with its role and nothing else.
 */

const LINK_CLASS =
  'font-medium text-[var(--color-primary)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded';

type Translator = Awaited<ReturnType<typeof getTranslations<'Models'>>>;

/** Modality, format and licence of a catalogue dataset, on one quiet line each. */
function Facts({ facts, t }: { facts: ModelCardDatasetFacts; t: Translator }) {
  const rows: Array<[string, string]> = [];
  if (facts.modalities.length > 0) rows.push([t('data.modality'), facts.modalities.join(', ')]);
  if (facts.formats.length > 0) rows.push([t('data.format'), facts.formats.join(', ')]);
  if (facts.licence) rows.push([t('data.licence'), facts.licence]);
  if (rows.length === 0) return null;
  return (
    <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-[var(--color-muted-foreground)]">{term}</dt>
          <dd className="break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DeclaredDataset({ dataset, t }: { dataset: ModelCardDatasetRef; t: Translator }) {
  return (
    <li className="py-4 first:pt-0 last:pb-0">
      {/* The role on its own line, so every entry reads the same whatever the name's length. */}
      <div className="flex flex-col items-start gap-1.5">
        <Badge tone="neutral">{t(`datasetRole.${dataset.role}`)}</Badge>
        {dataset.kind === 'WITHHELD' ? (
          <span className="text-[var(--color-muted-foreground)]">{t('data.withheld')}</span>
        ) : dataset.kind === 'EXTERNAL' && dataset.externalUrl ? (
          <a href={dataset.externalUrl} target="_blank" rel="noreferrer" className={LINK_CLASS}>
            <span className="break-words">{dataset.externalName}</span>
            <ExternalLinkIcon size={14} className="ms-1 inline align-baseline" />
            <span className="sr-only"> ({t('data.opensElsewhere')})</span>
          </a>
        ) : dataset.dataset && dataset.datasetSlug ? (
          <Link
            href={`/catalog/${encodeURIComponent(dataset.datasetSlug)}`}
            className={`${LINK_CLASS} break-words`}
          >
            {dataset.dataset.name}
          </Link>
        ) : (
          <span className="break-all font-mono text-sm">{dataset.datasetSlug}</span>
        )}
      </div>
      {dataset.kind === 'EXTERNAL' ? (
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{t('data.external')}</p>
      ) : null}
      {dataset.dataset ? <Facts facts={dataset.dataset} t={t} /> : null}
      {dataset.manifestVersion ? (
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
          {t('data.versionPinned', { version: dataset.manifestVersion })}
        </p>
      ) : null}
      {dataset.note ? (
        <p className="mt-2 text-sm">
          <span className="text-[var(--color-muted-foreground)]">{t('data.note')}: </span>
          {dataset.note}
        </p>
      ) : null}
    </li>
  );
}

function MeasuredDataset({ entry, t }: { entry: ModelCardEvaluatedOn; t: Translator }) {
  return (
    <li className="py-4 first:pt-0 last:pb-0">
      {entry.dataset ? (
        <Link
          href={`/catalog/${encodeURIComponent(entry.datasetSlug)}`}
          className={`${LINK_CLASS} break-words`}
        >
          {entry.dataset.name}
        </Link>
      ) : (
        <span className="break-all font-mono text-sm">{entry.datasetSlug}</span>
      )}
      <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
        <Link href={`/evaluation/${encodeURIComponent(entry.taskSlug)}`} className={LINK_CLASS}>
          {t('data.task', { name: entry.taskName })}
        </Link>
        {entry.datasetVersion ? (
          <> · {t('data.versionEvaluated', { version: entry.datasetVersion })}</>
        ) : null}
      </p>
      {entry.dataset ? <Facts facts={entry.dataset} t={t} /> : null}
    </li>
  );
}

export async function ModelDataCard({
  declared,
  measured,
}: {
  declared: ReadonlyArray<ModelCardDatasetRef>;
  measured: ReadonlyArray<ModelCardEvaluatedOn>;
}) {
  const t = await getTranslations('Models');
  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle as="h2">{t('data.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <section aria-labelledby="model-data-declared">
          <h3 id="model-data-declared" className="text-sm font-semibold">
            {t('data.declared')}
          </h3>
          {declared.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">
              {t('data.declaredEmpty')}
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--color-border)]">
              {declared.map((dataset, i) => (
                <DeclaredDataset key={i} dataset={dataset} t={t} />
              ))}
            </ul>
          )}
        </section>
        {measured.length > 0 ? (
          <section aria-labelledby="model-data-measured">
            <h3 id="model-data-measured" className="text-sm font-semibold">
              {t('data.measured')}
            </h3>
            <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
              {t('data.measuredHint')}
            </p>
            <ul className="mt-3 divide-y divide-[var(--color-border)]">
              {measured.map((entry) => (
                <MeasuredDataset key={entry.taskSlug} entry={entry} t={t} />
              ))}
            </ul>
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
