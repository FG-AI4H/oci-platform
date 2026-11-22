import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  ArrowLeftIcon,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Container,
  Section,
} from '@oci/ui';
import { auth } from '../../../auth';
import { requireHost } from '../../../lib/groups';
import { NewDatasetForm } from './new-dataset-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('CatalogNew');
  return {
    title: t('metaTitle'),
    // Host workflow pages must not be indexed: they live behind auth and
    // their content has no value to anonymous crawlers.
    robots: { index: false, follow: false },
  };
}

export default async function NewDatasetPage() {
  const session = await auth();
  requireHost(session);
  const t = await getTranslations('CatalogNew');

  return (
    <Container size="md">
      <Section spacing="md">
        <header className="mb-6 space-y-3">
          <Link
            href="/catalog"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded"
          >
            <ArrowLeftIcon size={14} />
            <span>{t('back')}</span>
          </Link>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            {t('eyebrow')}
          </p>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{t('heading')}</h1>
          <p className="max-w-prose text-[var(--color-muted-foreground)]">{t('intro')}</p>
        </header>

        <Alert tone="info" className="mb-6">
          <AlertTitle>{t('slugPermanent.title')}</AlertTitle>
          <AlertDescription>
            {t.rich('slugPermanent.body', { code: (chunks) => <code>{chunks}</code> })}
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>{t('draftDetails')}</CardTitle>
          </CardHeader>
          <CardContent>
            <NewDatasetForm />
          </CardContent>
        </Card>
      </Section>
    </Container>
  );
}
