export default function HomePage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-2xl text-center space-y-4">
        <h1 className="text-4xl font-bold">OCI Platform</h1>
        <p className="text-lg text-muted-foreground">
          Open Code Initiative — unified platform for the ITU-WHO-WIPO Global Initiative on AI for
          Health (GI-AI4H).
        </p>
        <p className="text-sm">
          Phase A scaffold — see <code>docs/getting-started.md</code> to bring up the full stack.
        </p>
      </div>
    </main>
  );
}
