import Link from 'next/link';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ChartIcon,
  Container,
  DatabaseIcon,
  FileTextIcon,
  FlowIcon,
  GlobeIcon,
  Section,
  ShieldIcon,
  Stat,
} from '@oci/ui';
import type { ListDatasetsResponse } from '@oci/shared-types';
import { getTranslations } from 'next-intl/server';
import { auth } from '../auth';
import { getFormatters } from '../i18n/server';
import { apiFetch } from '../lib/api';
import { isHost } from '../lib/groups';

// Label varies per env so the CTA matches reality. NextAuth's
// `pages.signIn = '/signin'` (auth.ts) routes both flows through
// the same branded page; this is just the link text.
const isLocalSignIn =
  process.env.OCI_ENV === 'local' || process.env.NEXT_PUBLIC_OCI_ENV === 'local';

interface PhaseCard {
  id: 'A' | 'B' | 'C' | 'D';
  status: 'live' | 'in-progress' | 'planned';
  icon: typeof DatabaseIcon;
  accent: 'phase-a' | 'phase-b' | 'phase-c' | 'phase-d';
  href?: string;
}

const PHASES: PhaseCard[] = [
  {
    id: 'A',
    status: 'live',
    icon: DatabaseIcon,
    accent: 'phase-a',
    href: '/catalog',
  },
  {
    id: 'B',
    status: 'in-progress',
    icon: FlowIcon,
    accent: 'phase-b',
  },
  {
    id: 'C',
    status: 'in-progress',
    icon: ChartIcon,
    accent: 'phase-c',
    href: '/evaluation',
  },
  {
    id: 'D',
    status: 'planned',
    icon: FileTextIcon,
    accent: 'phase-d',
  },
];

const PHASE_STATUS: Record<
  PhaseCard['status'],
  { key: 'live' | 'inProgress' | 'planned'; tone: 'success' | 'info' | 'neutral' }
> = {
  live: { key: 'live', tone: 'success' },
  'in-progress': { key: 'inProgress', tone: 'info' },
  planned: { key: 'planned', tone: 'neutral' },
};

function phaseIconClass(id: PhaseCard['id']): string {
  switch (id) {
    case 'A':
      return 'bg-[var(--color-phase-a)]/10 text-[var(--color-phase-a)]';
    case 'B':
      return 'bg-[var(--color-phase-b)]/10 text-[var(--color-phase-b)]';
    case 'C':
      return 'bg-[var(--color-phase-c)]/10 text-[var(--color-phase-c)]';
    case 'D':
      return 'bg-[var(--color-phase-d)]/10 text-[var(--color-phase-d)]';
  }
}

export default async function HomePage() {
  const [session, t, f] = await Promise.all([auth(), getTranslations('Home'), getFormatters()]);

  // Best-effort: a single small server-side call for the stat strip.
  // Live (no cache) so the count tracks the catalog as datasets get
  // published and unpublished — a 60s window made the homepage feel
  // stale during host workflows. The query is cheap (limit=1, only
  // reads totalEstimate) so per-request rendering is fine. If the API
  // is unreachable we fall back to placeholders so the homepage still
  // loads when the catalog service is down.
  let totalDatasets: number | null = null;
  try {
    const res = await apiFetch<ListDatasetsResponse>('/v2/catalog/datasets?limit=1', {
      session,
      revalidate: 0,
    });
    if (res) totalDatasets = res.totalEstimate;
  } catch {
    totalDatasets = null;
  }

  return (
    <>
      <Section spacing="hero" surface="hero">
        <Container>
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
              {t.rich('convenedBy', {
                strong: (chunks) => (
                  <span className="text-[var(--color-foreground)]">{chunks}</span>
                ),
              })}
            </p>
            <h1 className="mt-6 font-semibold text-[var(--color-foreground)] [font-size:var(--text-display)] [line-height:var(--text-display--line-height)] [letter-spacing:var(--text-display--letter-spacing)]">
              {t('titleLead')}
              <span className="block bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-accent)] bg-clip-text text-transparent">
                {t('titleAccent')}
              </span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-base sm:text-lg text-[var(--color-muted-foreground)]">
              {t('lede')}
            </p>

            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              {session?.user ? (
                <>
                  <Button asChild size="lg">
                    <Link href="/dashboard">{t('openDashboard')}</Link>
                  </Button>
                  <Button asChild variant="outline" size="lg">
                    <Link href="/catalog">{t('browseCatalog')}</Link>
                  </Button>
                </>
              ) : (
                <>
                  {/*
                   * Anchor sign-in to the branded /signin page rather
                   * than calling `signIn('cognito')` directly. The
                   * latter silently auto-signed users in as
                   * `local-dev@oci.ai4h.net` + `host,admin` in local
                   * mode (#79) — there was no path to the credentials
                   * picker. /signin handles both env modes uniformly.
                   */}
                  <Button asChild size="lg">
                    <Link href="/signin?callbackUrl=%2Fdashboard">
                      {isLocalSignIn ? t('signInLocal') : t('signInCognito')}
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="lg">
                    <Link href="/catalog">{t('browseCatalog')}</Link>
                  </Button>
                </>
              )}
            </div>
          </div>
        </Container>
      </Section>

      <Section spacing="md">
        <Container>
          <div className="grid gap-8 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-8 sm:grid-cols-3">
            <Stat
              icon={<DatabaseIcon size={20} />}
              value={totalDatasets === null ? '—' : f.number(totalDatasets)}
              label={t('stats.datasetsLabel')}
              hint={t('stats.datasetsHint')}
            />
            <Stat
              icon={<ShieldIcon size={20} />}
              value="Croissant 1.1"
              label={t('stats.conformanceLabel')}
              hint={t('stats.conformanceHint')}
            />
            <Stat
              icon={<GlobeIcon size={20} />}
              value={t('stats.openSourceValue')}
              label={t('stats.openSourceLabel')}
              hint={t('stats.openSourceHint')}
            />
          </div>
        </Container>
      </Section>

      <Section spacing="md">
        <Container>
          <div className="mb-10 max-w-2xl">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
              {t('roadmapEyebrow')}
            </p>
            <h2 className="mt-3 text-2xl sm:text-3xl font-semibold tracking-tight">
              {t('roadmapTitle')}
            </h2>
            <p className="mt-3 text-[var(--color-muted-foreground)]">{t('roadmapBody')}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {PHASES.map((phase) => {
              const Icon = phase.icon;
              const status = PHASE_STATUS[phase.status];
              const iconClass = phaseIconClass(phase.id);
              const card = (
                <Card
                  accent={phase.accent}
                  interactive={phase.href ? 'hover' : 'none'}
                  className="h-full"
                >
                  <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className={
                            'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md ' +
                            iconClass
                          }
                          aria-hidden="true"
                        >
                          <Icon size={18} />
                        </span>
                        <CardTitle className="min-w-0">
                          <span className="text-xs font-medium tracking-wider text-[var(--color-muted-foreground)]">
                            {t('phaseLabel', { id: phase.id })}{' '}
                          </span>
                          {t(`phases.${phase.id}.title`)}
                        </CardTitle>
                      </div>
                      <Badge tone={status.tone}>{t(`status.${status.key}`)}</Badge>
                    </div>
                    <CardDescription className="mt-2">
                      {t(`phases.${phase.id}.description`)}
                    </CardDescription>
                  </CardHeader>
                </Card>
              );
              return phase.href ? (
                <Link
                  key={phase.id}
                  href={phase.href}
                  className="rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
                >
                  {card}
                </Link>
              ) : (
                <div key={phase.id}>{card}</div>
              );
            })}
          </div>
        </Container>
      </Section>

      <Section spacing="lg">
        <Container size="lg">
          <Card tone="subtle" className="border-dashed">
            <CardHeader>
              <CardTitle>{t('hostsTitle')}</CardTitle>
              <CardDescription>{t('hostsBody')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-3">
                {isHost(session) ? (
                  <Button asChild>
                    <Link href="/catalog/new">{t('createDataset')}</Link>
                  </Button>
                ) : !session?.user ? (
                  <Button asChild>
                    <Link href="/signin?callbackUrl=%2Fcatalog%2Fnew">{t('signInToPublish')}</Link>
                  </Button>
                ) : null}
                <Link
                  href="/catalog"
                  className="text-sm font-medium text-[var(--color-primary)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded"
                >
                  {t('readCatalog')}
                </Link>
              </div>
            </CardContent>
          </Card>
        </Container>
      </Section>
    </>
  );
}
