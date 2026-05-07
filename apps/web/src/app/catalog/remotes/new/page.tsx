import Link from 'next/link';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  ArrowLeftIcon,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Container,
  Section,
} from '@oci/ui';
import { auth } from '../../../../auth';
import { requireAdmin } from '../../../../lib/groups';
import { NewRemoteForm } from './new-remote-form';

export const metadata = {
  title: 'Register peer — OCI Platform',
  robots: { index: false, follow: false },
};

export default async function NewRemoteCatalogPage() {
  const session = await auth();
  requireAdmin(session);

  return (
    <Container size="md">
      <Section spacing="md">
        <header className="mb-6 space-y-3">
          <Link
            href="/catalog/remotes"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded"
          >
            <ArrowLeftIcon size={14} />
            <span>Remote catalogues</span>
          </Link>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            Federation
          </p>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Register a peer</h1>
          <p className="max-w-prose text-[var(--color-muted-foreground)]">
            Add a peer Croissant catalogue. PR&nbsp;E.3&apos;s harvest worker will start mirroring
            its public datasets on the next cron tick.
          </p>
        </header>

        <Alert tone="info" className="mb-6">
          <AlertTitle>Slug is permanent</AlertTitle>
          <AlertDescription>
            Used to namespace harvested rows so they don&apos;t collide with local datasets. Pick
            something stable.
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>Peer details</CardTitle>
          </CardHeader>
          <CardContent>
            <NewRemoteForm />
          </CardContent>
        </Card>
      </Section>
    </Container>
  );
}
