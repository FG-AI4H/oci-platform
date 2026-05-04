import { auth, signIn, signOut } from '../auth';

export default async function HomePage() {
  const session = await auth();

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-2xl text-center space-y-4">
        <h1 className="text-4xl font-bold">OCI Platform</h1>
        <p className="text-lg text-muted-foreground">
          Open Code Infrastructure — unified platform for the ITU-WHO-WIPO Global Initiative on AI
          for Health (GI-AI4H).
        </p>
        <p className="text-sm">
          Phase A scaffold — see <code>docs/getting-started.md</code> to bring up the full stack.
        </p>

        <div className="pt-6">
          {session?.user ? (
            <div className="space-y-3">
              <p className="text-sm">
                Signed in as <strong>{session.user.email ?? session.user.name}</strong>
              </p>
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
            </div>
          ) : (
            <form
              action={async () => {
                'use server';
                await signIn('cognito', { redirectTo: '/' });
              }}
            >
              <button type="submit" className="px-4 py-2 border rounded">
                Sign in with Cognito
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
