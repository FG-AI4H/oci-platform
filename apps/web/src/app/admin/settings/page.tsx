import Link from 'next/link';
import {
  ArrowLeftIcon,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Container,
  Section,
} from '@oci/ui';
import type { PlatformSettingsResponse } from '@oci/shared-types';
import { auth } from '../../../auth';
import { apiFetch } from '../../../lib/api';
import { requireAdmin } from '../../../lib/groups';
import { MaintenanceBannerForm } from './maintenance-banner-form';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Settings — OCI Admin',
  robots: { index: false, follow: false },
};

export default async function AdminSettingsPage() {
  const session = await auth();
  requireAdmin(session);

  const settings = await apiFetch<PlatformSettingsResponse>('/v2/admin/settings', {
    session,
    revalidate: 0,
  });

  const dateFmt = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <Container size="md">
      <Section spacing="md">
        <header className="mb-6 space-y-3">
          <Link
            href="/admin"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded"
          >
            <ArrowLeftIcon size={14} />
            <span>Admin</span>
          </Link>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            Platform parameters
          </p>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Settings</h1>
          <p className="max-w-prose text-[var(--color-muted-foreground)]">
            Operator-managed parameters that apply across the whole instance. First-cut: a site-wide
            maintenance banner. Tool-integration registry (#214) and tier-aware license defaults
            (#235 phase 2) land here as those issues close.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Maintenance banner</CardTitle>
            <CardDescription>
              Renders above the site header for every visitor (anonymous and authenticated) while
              `now` is between visible-from and visible-until.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MaintenanceBannerForm initialBanner={settings?.maintenanceBanner ?? null} />
            {settings?.updatedAt ? (
              <p className="mt-6 text-xs text-[var(--color-muted-foreground)]">
                Last updated{' '}
                <time dateTime={settings.updatedAt}>
                  {dateFmt.format(new Date(settings.updatedAt))}
                </time>
                {settings.updatedBy ? (
                  <>
                    {' by '}
                    <span className="font-medium">{settings.updatedBy}</span>
                  </>
                ) : null}
                .
              </p>
            ) : null}
          </CardContent>
        </Card>
      </Section>
    </Container>
  );
}
