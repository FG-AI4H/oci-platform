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
import { auth, signIn } from '../auth';
import { apiFetch } from '../lib/api';

interface PhaseCard {
  id: 'A' | 'B' | 'C' | 'D';
  title: string;
  description: string;
  status: 'live' | 'in-progress' | 'planned';
  icon: typeof DatabaseIcon;
  accent: 'phase-a' | 'phase-b' | 'phase-c' | 'phase-d';
  href?: string;
}

const PHASES: PhaseCard[] = [
  {
    id: 'A',
    title: 'Catalog',
    description:
      'Discover datasets curated under the GI-AI4H Topic Groups. Croissant 1.1 + RAI + BIOCroissant manifests, with provenance and consent tracked end-to-end.',
    status: 'live',
    icon: DatabaseIcon,
    accent: 'phase-a',
    href: '/catalog',
  },
  {
    id: 'B',
    title: 'Annotation',
    description:
      'Coordinate multi-rater annotation with conflict resolution, regulator-grade audit trails, and burndown tooling.',
    status: 'in-progress',
    icon: FlowIcon,
    accent: 'phase-b',
  },
  {
    id: 'C',
    title: 'Evaluation',
    description:
      'Benchmark health AI models against open challenges in a sandboxed runner. Reports are reproducible and signed.',
    status: 'planned',
    icon: ChartIcon,
    accent: 'phase-c',
  },
  {
    id: 'D',
    title: 'Reporting',
    description:
      'JSON-LD evaluation reports for regulators, plus a portal that lets supervisors trace every claim back to its evidence.',
    status: 'planned',
    icon: FileTextIcon,
    accent: 'phase-d',
  },
];

const PHASE_STATUS_LABEL: Record<
  PhaseCard['status'],
  { label: string; tone: 'success' | 'info' | 'neutral' }
> = {
  live: { label: 'Live', tone: 'success' },
  'in-progress': { label: 'In progress', tone: 'info' },
  planned: { label: 'Planned', tone: 'neutral' },
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
  const session = await auth();

  // Best-effort: a single small server-side call for the stat strip.
  // If the API is unreachable we render placeholders — the homepage
  // must still load when the catalog service is down.
  let totalDatasets: number | null = null;
  try {
    const res = await apiFetch<ListDatasetsResponse>('/v2/catalog/datasets?limit=1', {
      session,
      revalidate: 60,
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
              Convened by <span className="text-[var(--color-foreground)]">ITU · WHO · WIPO</span> ·
              GI-AI4H
            </p>
            <h1 className="mt-6 font-semibold text-[var(--color-foreground)] [font-size:var(--text-display)] [line-height:var(--text-display--line-height)] [letter-spacing:var(--text-display--letter-spacing)]">
              Open Code Infrastructure
              <span className="block bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-accent)] bg-clip-text text-transparent">
                for trustworthy health AI
              </span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-base sm:text-lg text-[var(--color-muted-foreground)]">
              A unified platform for the Global Initiative on AI for Health — catalog, annotate,
              evaluate, and report on AI in clinical and public-health workflows, end to end.
            </p>

            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              {session?.user ? (
                <>
                  <Button asChild size="lg">
                    <Link href="/dashboard">Open dashboard</Link>
                  </Button>
                  <Button asChild variant="outline" size="lg">
                    <Link href="/catalog">Browse catalog</Link>
                  </Button>
                </>
              ) : (
                <>
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
                  <Button asChild variant="outline" size="lg">
                    <Link href="/catalog">Browse catalog</Link>
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
              value={totalDatasets === null ? '—' : totalDatasets.toLocaleString('en-GB')}
              label="Datasets in the catalog"
              hint="Curated under GI-AI4H Topic Groups"
            />
            <Stat
              icon={<ShieldIcon size={20} />}
              value="Croissant 1.1"
              label="Native conformance"
              hint="RAI + BIOCroissant health metadata"
            />
            <Stat
              icon={<GlobeIcon size={20} />}
              value="Open source"
              label="MIT licensed"
              hint="Reproducible, end-to-end auditable"
            />
          </div>
        </Container>
      </Section>

      <Section spacing="md">
        <Container>
          <div className="mb-10 max-w-2xl">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
              Platform · 12-18 month roadmap
            </p>
            <h2 className="mt-3 text-2xl sm:text-3xl font-semibold tracking-tight">
              Four workstreams, one provenance chain
            </h2>
            <p className="mt-3 text-[var(--color-muted-foreground)]">
              Every artefact — dataset, annotation, evaluation, report — points back to the dataset
              that fed it. So a regulator can trace any claim to its evidence, and a host can revoke
              a downstream artefact if consent is withdrawn upstream.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {PHASES.map((phase) => {
              const Icon = phase.icon;
              const status = PHASE_STATUS_LABEL[phase.status];
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
                            Phase {phase.id} ·{' '}
                          </span>
                          {phase.title}
                        </CardTitle>
                      </div>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </div>
                    <CardDescription className="mt-2">{phase.description}</CardDescription>
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
              <CardTitle>For dataset hosts</CardTitle>
              <CardDescription>
                Publishing on the catalog takes two steps: create a dataset, attach a Croissant 1.1
                manifest. We validate the manifest against Croissant + RAI + BIOCroissant before
                mirroring distributions, so what lands in the catalog is machine-readable and
                audit-ready.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-3">
                {session?.user ? (
                  <Button asChild>
                    <Link href="/catalog/new">Create a dataset</Link>
                  </Button>
                ) : (
                  <form
                    action={async () => {
                      'use server';
                      await signIn('cognito', { redirectTo: '/catalog/new' });
                    }}
                  >
                    <Button type="submit">Sign in to publish</Button>
                  </form>
                )}
                <Link
                  href="/catalog"
                  className="text-sm font-medium text-[var(--color-primary)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded"
                >
                  Read the catalog →
                </Link>
              </div>
            </CardContent>
          </Card>
        </Container>
      </Section>
    </>
  );
}
