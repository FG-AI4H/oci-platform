import Link from 'next/link';
import { redirect } from 'next/navigation';
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
  UserIcon,
} from '@oci/ui';
import { auth } from '../../auth';
import { isAnnotationWorker } from '../../lib/groups';

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

const EXPIRES_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function expiryTone(minutes: number): 'success' | 'warning' | 'danger' {
  if (minutes <= 0) return 'danger';
  if (minutes < 5) return 'warning';
  return 'success';
}

function expiryLabel(minutes: number): string {
  if (minutes <= 0) return 'expired';
  if (minutes < 60) return `expires in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem ? `expires in ${hours}h ${rem}m` : `expires in ${hours}h`;
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.accessToken) {
    redirect('/');
  }

  const result = await fetchMe(session.accessToken);
  const expiresInMin = result.ok
    ? Math.max(0, Math.round((new Date(result.data.expiresAt).getTime() - Date.now()) / 60_000))
    : null;

  return (
    <Container size="lg">
      <Section spacing="md">
        <header className="mb-8">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            Authenticated session
          </p>
          <h1 className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-3 max-w-2xl text-[var(--color-muted-foreground)]">
            Live identity for the bearer token in your NextAuth session, fetched server-side from{' '}
            <code className="rounded bg-[var(--color-muted)] px-1.5 py-0.5 font-mono text-xs">
              /v2/me
            </code>
            .
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
                <CardTitle>Annotation queue</CardTitle>
              </div>
              <CardDescription>
                Your Cognito role lets you pick up annotation work on RUNNING campaigns. Pull the
                next eligible task from the campaign list.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="primary">
                <Link href="/annotation/campaigns">Browse campaigns</Link>
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
                  <CardTitle>Principal</CardTitle>
                </div>
                <CardDescription>
                  Claims from the Cognito access token, verified by the API&apos;s aws-jwt-verify
                  guard.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DefinitionList>
                  <DefinitionItem term="Username">{result.data.username}</DefinitionItem>
                  <DefinitionItem term="Subject" mono>
                    {result.data.sub}
                  </DefinitionItem>
                  <DefinitionItem term="Groups">
                    {result.data.groups.length === 0 ? (
                      <span className="text-[var(--color-muted-foreground)]">None assigned</span>
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
                  <CardTitle>Token</CardTitle>
                </div>
                <CardDescription>
                  Cognito access token claims and expiry — refresh by signing back in if you see
                  warnings here.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <DefinitionList>
                  <DefinitionItem term="Use" mono>
                    {result.data.tokenUse}
                  </DefinitionItem>
                  <DefinitionItem term="Scope" mono>
                    {result.data.scope}
                  </DefinitionItem>
                </DefinitionList>
                <Separator />
                <div className="space-y-2 text-sm">
                  <p className="flex items-center gap-2 text-[var(--color-muted-foreground)]">
                    <ClockIcon size={14} />
                    <span>Expires</span>
                  </p>
                  <p className="font-mono text-xs">
                    {EXPIRES_FORMATTER.format(new Date(result.data.expiresAt))}
                  </p>
                  {expiresInMin !== null && (
                    <Badge tone={expiryTone(expiresInMin)}>
                      <ClockIcon size={12} />
                      <span>{expiryLabel(expiresInMin)}</span>
                    </Badge>
                  )}
                </div>
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
                  <CardTitle>Security note</CardTitle>
                </div>
                <CardDescription>
                  Bearer tokens are visible to the server only. The web container forwards them to{' '}
                  <code className="font-mono">/v2/*</code> with TLS — they do not travel to your
                  browser.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        ) : (
          <Alert tone="danger">
            <AlertTitle>
              {result.status ? `API responded ${result.status}` : 'API unreachable'}
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
