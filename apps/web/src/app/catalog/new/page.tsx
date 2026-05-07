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
import { auth } from '../../../auth';
import { requireHost } from '../../../lib/groups';
import { NewDatasetForm } from './new-dataset-form';

export const metadata = {
  title: 'New dataset — OCI Catalog',
  // Host workflow pages must not be indexed: they live behind auth and
  // their content has no value to anonymous crawlers.
  robots: { index: false, follow: false },
};

export default async function NewDatasetPage() {
  const session = await auth();
  requireHost(session);

  return (
    <Container size="md">
      <Section spacing="md">
        <header className="mb-6 space-y-3">
          <Link
            href="/catalog"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded"
          >
            <ArrowLeftIcon size={14} />
            <span>Catalog</span>
          </Link>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            Host workflow
          </p>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">New dataset</h1>
          <p className="max-w-prose text-[var(--color-muted-foreground)]">
            Create a draft. After this step you&apos;ll attach a Croissant&nbsp;1.1 manifest to
            publish your first version.
          </p>
        </header>

        <Alert tone="info" className="mb-6">
          <AlertTitle>Slug is permanent</AlertTitle>
          <AlertDescription>
            The slug becomes part of your catalog URL and the Croissant <code>@id</code>. Choose
            deliberately — slugs cannot be renamed once published.
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>Draft details</CardTitle>
          </CardHeader>
          <CardContent>
            <NewDatasetForm />
          </CardContent>
        </Card>
      </Section>
    </Container>
  );
}
