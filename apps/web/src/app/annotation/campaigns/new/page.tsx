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
import type {
  AnnotationToolIntegrationSummary,
  DatasetDetail,
  UserPreferences,
} from '@oci/shared-types';
import { auth } from '../../../../auth';
import { getFormatters } from '../../../../i18n/server';
import { apiFetch } from '../../../../lib/api';
import { requireCampaignManager } from '../../../../lib/groups';
import { NewCampaignForm, type PreselectedDataset } from './new-campaign-form';

export async function generateMetadata() {
  const t = await getTranslations('Campaign.newCampaign');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/**
 * Locale for the cost-estimate numbers (#582): the user's preference
 * (#144) when `Intl` knows it, otherwise the interface language's
 * (`en-GB` in English, as before). Resolved here rather than from the
 * browser so the server and client renders agree.
 */
function numberLocaleFor(preferred: string | null | undefined, fallback: string): string {
  if (!preferred) return fallback;
  try {
    return Intl.NumberFormat.supportedLocalesOf([preferred])[0] ?? fallback;
  } catch {
    // Matches LocaleSchema's loose shape but isn't a valid BCP-47 tag.
    return fallback;
  }
}

interface NewCampaignPageProps {
  /**
   * Optional `?datasetSlug=` (preferred, set by the catalog detail
   * page's "Create annotation campaign" CTA) or legacy `?datasetId=`
   * (still parsed for back-compat — never produced by the platform).
   */
  searchParams: Promise<{ datasetSlug?: string; datasetId?: string }>;
}

export default async function NewCampaignPage({ searchParams }: NewCampaignPageProps) {
  const session = await auth();
  requireCampaignManager(session);
  const [t, fmt] = await Promise.all([getTranslations('Campaign.newCampaign'), getFormatters()]);

  const { datasetSlug, datasetId } = await searchParams;

  // Resolve the slug to a full dataset summary server-side so the
  // form can render with the picker already populated. Visibility is
  // enforced by the API — if the manager isn't authorised to see the
  // dataset they get a 404 here, and we fall back to the empty
  // picker.
  let preselected: PreselectedDataset | null = null;
  if (datasetSlug) {
    const ds = await apiFetch<DatasetDetail>(
      `/v2/catalog/datasets/${encodeURIComponent(datasetSlug)}`,
      { session, revalidate: 0 },
    );
    if (ds) {
      preselected = {
        id: ds.id,
        slug: ds.slug,
        name: ds.name,
        accessTier: ds.accessTier ?? 'OPEN',
        // #247: surface modalities so the form can disable incompatible
        // task-kind radios with a rationale tooltip.
        modalities: ds.modalities ?? [],
      };
    }
  } else if (datasetId) {
    // Legacy `?datasetId=` (no longer minted by the platform). The
    // form will try to resolve it client-side via the typeahead.
    preselected = null;
  }

  const [toolsResponse, preferences] = await Promise.all([
    apiFetch<AnnotationToolIntegrationSummary[]>('/v2/annotation/tool-integrations', {
      session,
      revalidate: 0,
    }),
    // Only formats numbers: a preferences outage falls back to the
    // default locale instead of failing the form.
    apiFetch<UserPreferences>('/v2/preferences/me', { session, revalidate: 0 }).catch(() => null),
  ]);
  const tools = toolsResponse ?? [];

  return (
    <Container size="md">
      <Section spacing="md">
        <header className="mb-6 space-y-3">
          <Link
            href="/annotation/campaigns"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded"
          >
            <ArrowLeftIcon size={14} />
            <span>{t('back')}</span>
          </Link>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            {t('eyebrow')}
          </p>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="max-w-prose text-[var(--color-muted-foreground)]">{t('intro')}</p>
        </header>

        <Alert tone="info" className="mb-6">
          <AlertTitle>{t('slugPermanentTitle')}</AlertTitle>
          <AlertDescription>{t('slugPermanentBody')}</AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>{t('draftDetails')}</CardTitle>
          </CardHeader>
          <CardContent>
            <NewCampaignForm
              toolIntegrations={tools}
              preselectedDataset={preselected}
              numberLocale={numberLocaleFor(preferences?.locale, fmt.intlLocale)}
            />
          </CardContent>
        </Card>
      </Section>
    </Container>
  );
}
