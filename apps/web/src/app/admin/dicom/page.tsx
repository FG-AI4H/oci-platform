import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle, ArrowLeftIcon, Container, Section } from '@oci/ui';
import type { DicomHeldDatasetList } from '@oci/shared-types';
import { auth } from '../../../auth';
import { apiFetch } from '../../../lib/api';
import { countOf } from '../../../lib/dicom-findings';
import { requireAdmin } from '../../../lib/groups';

export const metadata = {
  title: 'Held images — OCI Admin',
  robots: { index: false, follow: false },
};

const LINK =
  'rounded font-medium text-[var(--color-primary)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]';

/**
 * The operator's queue: datasets with DICOM images that are held
 * (#674, ADR-0026). A held image is seen by its host and by operators
 * only, until an operator has decided on what was found in its header.
 */
export default async function HeldImagesPage() {
  const session = await auth();
  requireAdmin(session);

  let list: DicomHeldDatasetList | null = null;
  let failed = false;
  try {
    list = await apiFetch<DicomHeldDatasetList>('/v2/storage/dicom/held', {
      session,
      revalidate: 0,
    });
  } catch {
    failed = true;
  }
  const datasets = list?.datasets ?? [];

  return (
    <Container size="md">
      <Section spacing="md">
        <Link
          href="/admin"
          className={`mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm sm:min-h-6 ${LINK}`}
        >
          <ArrowLeftIcon size={14} />
          Admin
        </Link>
        <header className="mb-6 space-y-3">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            Operator workflow
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Held images</h1>
          <p className="max-w-prose text-[var(--color-muted-foreground)]">
            When a DICOM file is uploaded, the platform reads its header. A file that carries a
            value de-identification normally removes is held: only its host and operators see it.
            Review what was found, dataset by dataset, and release what identifies nobody.
          </p>
        </header>

        {failed ? (
          <Alert tone="danger">
            <AlertTitle>Queue unavailable</AlertTitle>
            <AlertDescription>The list of held images could not be loaded.</AlertDescription>
          </Alert>
        ) : datasets.length === 0 ? (
          <Alert tone="success">
            <AlertDescription>No image is held. There is nothing to review.</AlertDescription>
          </Alert>
        ) : (
          <section aria-labelledby="queue-heading" className="space-y-3">
            <h2 id="queue-heading" className="text-lg font-semibold">
              Datasets to review
            </h2>
            <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
              {datasets.map((dataset) => (
                <li
                  key={dataset.slug}
                  className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium">{dataset.name}</p>
                    <p className="text-sm text-[var(--color-muted-foreground)]">
                      {[
                        dataset.heldInstanceCount > 0
                          ? `${countOf(dataset.heldInstanceCount, 'image', 'images')} held for findings`
                          : null,
                        dataset.unreadableInstanceCount > 0
                          ? `${countOf(dataset.unreadableInstanceCount, 'file', 'files')} could not be checked`
                          : null,
                      ]
                        .filter((part): part is string => part !== null)
                        .join(' · ')}
                    </p>
                  </div>
                  <Link
                    href={`/admin/dicom/${dataset.slug}`}
                    aria-label={`Review ${dataset.name}`}
                    className={`inline-flex min-h-11 shrink-0 items-center text-sm sm:min-h-6 ${LINK}`}
                  >
                    Review
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </Section>
    </Container>
  );
}
