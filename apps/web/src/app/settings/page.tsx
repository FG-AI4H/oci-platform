import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Container,
  Section,
} from '@oci/ui';
import type { UserPreferences } from '@oci/shared-types';
import { auth } from '../../auth';
import { apiFetch } from '../../lib/api';
import { PreferencesForm } from './preferences-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Settings');
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    robots: { index: false, follow: false },
  };
}

const FALLBACK: UserPreferences = {
  darkMode: 'system',
  locale: null,
  density: 'comfortable',
  updatedAt: new Date(0).toISOString(),
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect('/signin?callbackUrl=%2Fsettings');
  }

  const initial =
    (await apiFetch<UserPreferences>('/v2/preferences/me', {
      session,
      revalidate: 0,
    })) ?? FALLBACK;

  const params = await searchParams;
  const t = await getTranslations('Settings');
  const savedFlag = params.saved === '1';

  return (
    <Container>
      <Section>
        <header className="mb-8 space-y-2">
          <h1 className="text-display tracking-tight text-[var(--color-foreground)]">
            {t('title')}
          </h1>
          <p className="max-w-2xl text-base text-[var(--color-muted-foreground)]">{t('lede')}</p>
        </header>

        <div className="max-w-2xl">
          <Card>
            <CardHeader>
              <CardTitle>{t('appearanceTitle')}</CardTitle>
              <CardDescription>
                {t.rich('appearanceDescription', { code: (chunks) => <code>{chunks}</code> })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PreferencesForm initial={initial} savedFlag={savedFlag} />
            </CardContent>
          </Card>
        </div>
      </Section>
    </Container>
  );
}
