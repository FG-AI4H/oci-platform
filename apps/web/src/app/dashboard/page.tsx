import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ClockIcon,
  Container,
  DefinitionItem,
  DefinitionList,
  FlowIcon,
  KeyIcon,
  Section,
  Separator,
  ShieldIcon,
  SparkIcon,
  UserIcon,
} from '@oci/ui';
import type { ModelCardStatus } from '@oci/shared-types';
import { auth, sessionAccessToken } from '../../auth';
import { getFormatters } from '../../i18n/server';
import { isAnnotationWorker } from '../../lib/groups';
import { myModelCards } from '../../lib/model-card-viewer';

interface MeResponse {
  sub: string;
  username: string;
  groups: string[];
  scope: string;
  tokenUse: string;
  expiresAt: string;
}

type FetchResult = { ok: true; data: MeResponse } | { ok: false; status: number; message: string };

async function fetchMe(accessToken: string): Promise<FetchResult> {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    return {
      ok: false,
      status: 0,
      message: 'NEXT_PUBLIC_API_BASE_URL not set in web container env',
    };
  }
  let res: Response;
  try {
    res = await fetch(`${base}/v2/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
  } catch (err) {
    return { ok: false, status: 0, message: err instanceof Error ? err.message : 'fetch failed' };
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: await res.text().catch(() => res.statusText),
    };
  }
  return { ok: true, data: (await res.json()) as MeResponse };
}

const groupTone = (group: string) => {
  switch (group) {
    case 'admin':
      return 'danger';
    case 'regulator':
    case 'supervisor':
      return 'warning';
    case 'reviewer':
    case 'host':
      return 'primary';
    case 'annotator':
    case 'participant':
      return 'info';
    default:
      return 'neutral';
  }
};

const MODEL_STATUS_TONE: Record<ModelCardStatus, 'neutral' | 'info' | 'success' | 'warning'> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  PUBLISHED: 'success',
  WITHDRAWN: 'warning',
};

function expiryTone(minutes: number): 'success' | 'warning' | 'danger' {
  if (minutes <= 0) return 'danger';
  if (minutes < 5) return 'warning';
  return 'success';
}

function expiryLabel(
  t: Awaited<ReturnType<typeof getTranslations<'Dashboard'>>>,
  minutes: number,
): string {
  if (minutes <= 0) return t('token.expired');
  if (minutes < 60) return t('token.inMinutes', { minutes: String(minutes) });
  const hours = String(Math.floor(minutes / 60));
  const rem = minutes % 60;
  return rem
    ? t('token.inHoursMinutes', { hours, minutes: String(rem) })
    : t('token.inHours', { hours });
}

export default async function DashboardPage() {
  const session = await auth();
  const accessToken = session?.user ? await sessionAccessToken() : null;
  if (!session?.user || !accessToken) {
    redirect('/');
  }

  const [result, t, f, tModels, tCard, myModels] = await Promise.all([
    fetchMe(accessToken),
    getTranslations('Dashboard'),
    getFormatters(),
    getTranslations('Models'),
    getTranslations('ModelCardForm'),
    myModelCards(session),
  ]);
  const expiresInMin = result.ok
    ? Math.max(0, Math.round((new Date(result.data.expiresAt).getTime() - Date.now()) / 60_000))
    : null;

  return (
    <Container size="lg">
      <Section spacing="md">
        <header className="mb-8">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            {t('eyebrow')}
          </p>
          <h1 className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-3 max-w-2xl text-[var(--color-muted-foreground)]">
            {t.rich('lede', {
              code: (chunks) => (
                <code className="rounded bg-[var(--color-muted)] px-1.5 py-0.5 font-mono text-xs">
                  {chunks}
                </code>
              ),
            })}
          </p>
        </header>

        {result.ok && isAnnotationWorker(session) ? (
          <Card accent="info" className="mb-6">
            <CardHeader>
              <div className="flex items-center gap-3">
                <span
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-[var(--color-info-soft)] text-[var(--color-info)]"
                  aria-hidden="true"
                >
                  <FlowIcon size={18} />
                </span>
                <CardTitle>{t('queue.title')}</CardTitle>
              </div>
              <CardDescription>{t('queue.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="primary">
                <Link href="/annotation/campaigns">{t('queue.browse')}</Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {result.ok ? (
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <span
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-[var(--color-primary-soft)] text-[var(--color-primary)]"
                    aria-hidden="true"
                  >
                    <UserIcon size={18} />
                  </span>
                  <CardTitle>{t('principal.title')}</CardTitle>
                </div>
                <CardDescription>{t('principal.description')}</CardDescription>
              </CardHeader>
              <CardContent>
                <DefinitionList>
                  <DefinitionItem term={t('principal.username')}>
                    <span translate="no">{result.data.username}</span>
                  </DefinitionItem>
                  <DefinitionItem term={t('principal.subject')} mono>
                    <span translate="no">{result.data.sub}</span>
                  </DefinitionItem>
                  <DefinitionItem term={t('principal.groups')}>
                    {result.data.groups.length === 0 ? (
                      <span className="text-[var(--color-muted-foreground)]">
                        {t('principal.noGroups')}
                      </span>
                    ) : (
                      <span className="flex flex-wrap gap-1.5">
                        {result.data.groups.map((g) => (
                          <Badge key={g} tone={groupTone(g)}>
                            {g}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </DefinitionItem>
                </DefinitionList>
              </CardContent>
            </Card>

            <Card accent={expiresInMin !== null ? expiryTone(expiresInMin) : 'none'}>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <span
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-[var(--color-accent-soft)] text-[var(--color-accent-foreground)]"
                    aria-hidden="true"
                  >
                    <KeyIcon size={18} />
                  </span>
                  <CardTitle>{t('token.title')}</CardTitle>
                </div>
                <CardDescription>{t('token.description')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <DefinitionList>
                  <DefinitionItem term={t('token.use')} mono>
                    <span translate="no">{result.data.tokenUse}</span>
                  </DefinitionItem>
                  <DefinitionItem term={t('token.scope')} mono>
                    <span translate="no">{result.data.scope}</span>
                  </DefinitionItem>
                </DefinitionList>
                <Separator />
                <div className="space-y-2 text-sm">
                  <p className="flex items-center gap-2 text-[var(--color-muted-foreground)]">
                    <ClockIcon size={14} />
                    <span>{t('token.expires')}</span>
                  </p>
                  <p className="font-mono text-xs">{f.dateTime(result.data.expiresAt)}</p>
                  {expiresInMin !== null && (
                    <Badge tone={expiryTone(expiresInMin)}>
                      <ClockIcon size={12} />
                      <span>{expiryLabel(t, expiresInMin)}</span>
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-3">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-[var(--color-primary-soft)] text-[var(--color-primary)]"
                      aria-hidden="true"
                    >
                      <SparkIcon size={18} />
                    </span>
                    <CardTitle>{t('myModels.title')}</CardTitle>
                  </div>
                  <Button asChild variant="secondary" size="sm">
                    <Link href="/models/new">{t('myModels.declare')}</Link>
                  </Button>
                </div>
                <CardDescription>{t('myModels.description')}</CardDescription>
              </CardHeader>
              <CardContent>
                {myModels === null ? (
                  <p className="text-sm text-[var(--color-muted-foreground)]">
                    {t('myModels.unavailable')}
                  </p>
                ) : myModels.items.length === 0 ? (
                  <p className="text-sm text-[var(--color-muted-foreground)]">
                    {t('myModels.empty')}
                  </p>
                ) : (
                  <ul className="divide-y divide-[var(--color-border)]">
                    {myModels.items.map((m) => (
                      <li
                        key={m.slug}
                        className="flex flex-wrap items-center justify-between gap-2 py-3"
                      >
                        <Link
                          href={`/models/${encodeURIComponent(m.slug)}`}
                          className="min-w-0 break-words rounded font-medium text-[var(--color-primary)] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
                        >
                          <span translate="no">{m.slug}</span>{' '}
                          <span className="font-mono text-xs text-[var(--color-muted-foreground)]">
                            v{m.versionMajorMinorPatch}
                          </span>
                        </Link>
                        <span className="flex flex-wrap items-center gap-2">
                          <Badge tone="info">{tModels('riskTier', { tier: m.riskTier })}</Badge>
                          <Badge tone={MODEL_STATUS_TONE[m.status]}>
                            {tCard(`lifecycle.status.${m.status}`)}
                          </Badge>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card tone="subtle" className="border-dashed lg:col-span-3">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <span
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-[var(--color-card)] text-[var(--color-muted-foreground)]"
                    aria-hidden="true"
                  >
                    <ShieldIcon size={18} />
                  </span>
                  <CardTitle>{t('security.title')}</CardTitle>
                </div>
                <CardDescription>
                  {t.rich('security.description', {
                    code: (chunks) => <code className="font-mono">{chunks}</code>,
                  })}
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        ) : (
          <Alert tone="danger">
            <AlertTitle>
              {result.status
                ? t('apiStatus', { status: String(result.status) })
                : t('apiUnreachable')}
            </AlertTitle>
            <AlertDescription>
              <pre className="mt-1 whitespace-pre-wrap break-words text-xs font-mono">
                {result.message}
              </pre>
            </AlertDescription>
          </Alert>
        )}
      </Section>
    </Container>
  );
}
