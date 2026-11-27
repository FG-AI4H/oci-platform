import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@oci/ui';
import type { ModelCardForDataset } from '@oci/shared-types';

/**
 * The published model cards whose developer declares this dataset (#820):
 * the dataset's side of the link shown on the model page. The API lists
 * PUBLISHED cards only, and only to a reader who may see the dataset.
 */
export async function DatasetModelsCard({
  models,
}: {
  models: ReadonlyArray<ModelCardForDataset>;
}) {
  const [t, tModels] = await Promise.all([getTranslations('Dataset'), getTranslations('Models')]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('models.title')}</CardTitle>
        <CardDescription>{t('models.intro')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-[var(--color-border)]">
          {models.map((model) => (
            <li
              key={model.slug}
              className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
            >
              <div className="min-w-0">
                <Link
                  href={`/models/${encodeURIComponent(model.slug)}`}
                  className="break-words font-medium text-[var(--color-primary)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded"
                >
                  {model.slug}
                </Link>
                {model.modelDeveloper ? (
                  <p className="text-sm text-[var(--color-muted-foreground)]">
                    {model.modelDeveloper}
                  </p>
                ) : null}
                <p className="mt-1 text-sm">
                  {t('models.roles', {
                    roles: model.roles.map((role) => tModels(`datasetRole.${role}`)).join(', '),
                  })}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Badge tone="primary">
                  {t('models.version', { version: model.versionMajorMinorPatch })}
                </Badge>
                <Badge tone="info">{t('models.riskTier', { tier: model.riskTier })}</Badge>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
