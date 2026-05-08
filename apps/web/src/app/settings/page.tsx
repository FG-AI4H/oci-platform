import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Container, Section } from '@oci/ui';
import type { UserPreferences } from '@oci/shared-types';
import { auth } from '../../auth';
import { apiFetch } from '../../lib/api';
import { PreferencesForm } from './preferences-form';

export const metadata = {
  title: 'Settings — OCI Platform',
  description: 'Manage your UI preferences: theme, density, language.',
  robots: { index: false, follow: false },
};

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

  const initial = (await apiFetch<UserPreferences>('/v2/preferences/me', {
    session,
    revalidate: 0,
  })) ?? FALLBACK;

  const params = await searchParams;
  const savedFlag = params.saved === '1';

  return (
    <Container>
      <Section>
        <header className="mb-8 space-y-2">
          <h1 className="text-display tracking-tight text-[var(--color-foreground)]">
            Settings
          </h1>
          <p className="max-w-2xl text-base text-[var(--color-muted-foreground)]">
            Per-user UI preferences. These are saved to your account and follow you across
            devices.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>
              Theme, density, and language. Stored in <code>identity.user_preferences</code>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PreferencesForm initial={initial} savedFlag={savedFlag} />
          </CardContent>
        </Card>
      </Section>
    </Container>
  );
}
