import { redirect } from 'next/navigation';
import { auth, signOut } from '../../auth';

interface MeResponse {
  sub: string;
  username: string;
  groups: string[];
  scope: string;
  tokenUse: string;
  expiresAt: string;
}

interface FetchResult {
  ok: true;
  data: MeResponse;
}

interface FetchError {
  ok: false;
  status: number;
  message: string;
}

async function fetchMe(accessToken: string): Promise<FetchResult | FetchError> {
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
    return { ok: false, status: res.status, message: await res.text().catch(() => res.statusText) };
  }
  return { ok: true, data: (await res.json()) as MeResponse };
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.accessToken) {
    redirect('/');
  }

  const result = await fetchMe(session.accessToken);

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Signed in as <strong>{session.user?.email ?? session.user?.name}</strong>
            </p>
          </div>
          <form
            action={async () => {
              'use server';
              await signOut({ redirectTo: '/' });
            }}
          >
            <button type="submit" className="px-4 py-2 border rounded">
              Sign out
            </button>
          </form>
        </header>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">/v2/me</h2>
          <p className="text-sm text-muted-foreground">
            Server-side fetch from this page&apos;s React Server Component, calling the OCI API with
            the Cognito access token from the NextAuth session as a Bearer header.
          </p>

          {result.ok ? (
            <dl className="grid grid-cols-1 sm:grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm border rounded p-4">
              <dt className="font-medium">sub</dt>
              <dd className="font-mono break-all">{result.data.sub}</dd>
              <dt className="font-medium">username</dt>
              <dd className="font-mono break-all">{result.data.username}</dd>
              <dt className="font-medium">groups</dt>
              <dd>{result.data.groups.length ? result.data.groups.join(', ') : '(none)'}</dd>
              <dt className="font-medium">scope</dt>
              <dd className="font-mono">{result.data.scope}</dd>
              <dt className="font-medium">tokenUse</dt>
              <dd className="font-mono">{result.data.tokenUse}</dd>
              <dt className="font-medium">expiresAt</dt>
              <dd className="font-mono">{result.data.expiresAt}</dd>
            </dl>
          ) : (
            <div className="border border-red-300 rounded p-4 text-sm space-y-2">
              <p className="font-medium text-red-700">
                {result.status ? `API responded ${result.status}` : 'API unreachable'}
              </p>
              <pre className="whitespace-pre-wrap text-xs">{result.message}</pre>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
