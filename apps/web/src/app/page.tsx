import Link from 'next/link';
import { Badge, Button, Card, CardDescription, CardHeader, CardTitle } from '@oci/ui';
import { auth, signIn } from '../auth';

const featureCards = [
  {
    title: 'Catalog',
    description:
      'Discover datasets and challenges curated under the GI-AI4H Topic Groups, with provenance and consent tracked end-to-end.',
    badge: 'Phase A',
  },
  {
    title: 'Annotation',
    description:
      'Coordinate multi-rater annotation with conflict resolution, regulator-grade audit trails, and burndown tooling.',
    badge: 'Phase B',
  },
  {
    title: 'Evaluation',
    description:
      'Benchmark health AI models against open challenges in a sandboxed runner. Reports are reproducible and signed.',
    badge: 'Phase C',
  },
  {
    title: 'Reporting',
    description:
      'Generate JSON-LD evaluation reports for regulators and a portal that lets supervisors trace every claim to evidence.',
    badge: 'Phase D',
  },
];

export default async function HomePage() {
  const session = await auth();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
      {/* Hero */}
      <section className="pt-20 sm:pt-28 pb-16 text-center">
        <Badge tone="primary" className="mb-6">
          ITU · WHO · WIPO
        </Badge>
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight text-[var(--color-foreground)]">
          Open Code Infrastructure
          <span className="block text-[var(--color-primary)] mt-2">for trustworthy health AI</span>
        </h1>
        <p className="mt-6 max-w-2xl mx-auto text-lg text-[var(--color-muted-foreground)]">
          A unified platform for the Global Initiative on AI for Health — catalog, annotate,
          evaluate, and report on AI in clinical and public-health workflows, end to end.
        </p>

        <div className="mt-8 flex items-center justify-center gap-3">
          {session?.user ? (
            <>
              <Link href="/dashboard">
                <Button size="lg">Open dashboard</Button>
              </Link>
              <a
                href="https://github.com/FG-AI4H/oci-platform"
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
              >
                Source on GitHub →
              </a>
            </>
          ) : (
            <form
              action={async () => {
                'use server';
                await signIn('cognito', { redirectTo: '/dashboard' });
              }}
            >
              <Button type="submit" size="lg">
                Sign in with Cognito
              </Button>
            </form>
          )}
        </div>
      </section>

      {/* Feature grid */}
      <section className="grid gap-4 sm:grid-cols-2 pb-20">
        {featureCards.map((feature) => (
          <Card key={feature.title} className="transition-shadow hover:shadow-[var(--shadow-md)]">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{feature.title}</CardTitle>
                <Badge tone="neutral">{feature.badge}</Badge>
              </div>
              <CardDescription>{feature.description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>
    </div>
  );
}
