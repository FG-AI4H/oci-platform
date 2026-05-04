import { redirect } from 'next/navigation';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DefinitionItem,
  DefinitionList,
} from '@oci/ui';
import { auth } from '../../auth';

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
    <div className="mx-auto w-full max-w-4xl px-4 sm:px-6 py-12 space-y-8">
      <header className="space-y-1">
        <p className="text-sm font-medium uppercase tracking-wider text-[var(--color-muted-foreground)]">
          Authenticated session
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-[var(--color-muted-foreground)]">
          Live identity for the bearer token in your NextAuth session, fetched server-side from{' '}
          <code className="font-mono text-xs px-1 py-0.5 rounded bg-[var(--color-muted)]">
            /v2/me
          </code>
          .
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Principal</CardTitle>
          <CardDescription>
            Claims from the Cognito access token, verified by the API&apos;s aws-jwt-verify guard.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {result.ok ? (
            <>
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
                <DefinitionItem term="Scope" mono>
                  {result.data.scope}
                </DefinitionItem>
                <DefinitionItem term="Token use" mono>
                  {result.data.tokenUse}
                </DefinitionItem>
                <DefinitionItem term="Expires">
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-xs">{result.data.expiresAt}</span>
                    {expiresInMin !== null && (
                      <Badge
                        tone={
                          expiresInMin === 0 ? 'danger' : expiresInMin < 5 ? 'warning' : 'success'
                        }
                      >
                        {expiresInMin === 0 ? 'expired' : `in ${expiresInMin} min`}
                      </Badge>
                    )}
                  </span>
                </DefinitionItem>
              </DefinitionList>
            </>
          ) : (
            <Alert tone="danger">
              <AlertTitle>
                {result.status ? `API responded ${result.status}` : 'API unreachable'}
              </AlertTitle>
              <AlertDescription>
                <pre className="mt-1 whitespace-pre-wrap text-xs font-mono">{result.message}</pre>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
