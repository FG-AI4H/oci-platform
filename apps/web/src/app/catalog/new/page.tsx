import Link from 'next/link';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
    <div className="mx-auto w-full max-w-2xl px-4 sm:px-6 py-12 space-y-6">
      <header className="space-y-2">
        <Link
          href="/catalog"
          className="text-sm text-[var(--color-muted-foreground)] hover:underline"
        >
          ← Catalog
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">New dataset</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Create a draft. After this step you&apos;ll attach a Croissant&nbsp;1.1 manifest to
          publish your first version.
        </p>
      </header>

      <Alert>
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
    </div>
  );
}
