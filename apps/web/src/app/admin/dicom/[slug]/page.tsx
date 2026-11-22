import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, AlertDescription, AlertTitle, ArrowLeftIcon, Container, Section } from '@oci/ui';
import { DatasetSlugSchema, type DicomFindingsReview } from '@oci/shared-types';
import { auth } from '../../../../auth';
import { apiFetch } from '../../../../lib/api';
import { countOf } from '../../../../lib/dicom-findings';
import { requireAdmin } from '../../../../lib/groups';
import { ReviewForm } from './review-form';

export const metadata = {
  title: 'Held images — OCI Admin',
  robots: { index: false, follow: false },
};

const LINK =
  'rounded font-medium text-[var(--color-primary)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]';

/**
 * The operator's review of the held DICOM images of one dataset
 * (#674, ADR-0026): what was found in their headers, and the decision.
 *
 * The values shown here may identify a patient. They are read from the
 * stored files for this page and kept nowhere, which is also why the
 * page is never cached.
 */
export default async function DicomReviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  requireAdmin(session);
  const { slug: rawSlug } = await params;
  const slug = DatasetSlugSchema.safeParse(rawSlug);
  if (!slug.success) notFound();

  let review: DicomFindingsReview | null = null;
  let error: string | null = null;
  try {
    review = await apiFetch<DicomFindingsReview>(
      `/v2/storage/datasets/${encodeURIComponent(slug.data)}/dicom/findings`,
      { session, revalidate: 0 },
    );
  } catch {
    error = 'The findings could not be loaded.';
  }
  if (!error && !review) notFound();

  const dateFmt = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <Container size="md">
      <Section spacing="md">
        <Link
          href="/admin/dicom"
          className={`mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm sm:min-h-6 ${LINK}`}
        >
          <ArrowLeftIcon size={14} />
          Held images
        </Link>

        {error || !review ? (
          <Alert tone="danger">
            <AlertTitle>Review unavailable</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
          <>
            <header className="mb-6 space-y-2">
              <p className="font-mono text-xs text-[var(--color-muted-foreground)]">
                {review.datasetSlug}
              </p>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                {review.datasetName}
              </h1>
              <p className="text-[var(--color-muted-foreground)]">
                {review.heldInstanceCount > 0
                  ? `${countOf(review.heldInstanceCount, 'image is', 'images are')} held for ${countOf(review.totalFindings, 'finding', 'findings')}.`
                  : 'No image of this dataset is held for findings.'}{' '}
                <Link href={`/catalog/${review.datasetSlug}`} className={LINK}>
                  Open the dataset to look at the images
                </Link>
                .
              </p>
            </header>

            {review.unreadableInstanceCount > 0 ? (
              <Alert tone="warning" className="mb-6">
                <AlertTitle as="h2">
                  {countOf(review.unreadableInstanceCount, 'file', 'files')} could not be checked
                </AlertTitle>
                <AlertDescription>
                  Their header could not be read, so nothing is known about what they contain. No
                  decision releases them: the host has to upload them again in a readable form.
                </AlertDescription>
              </Alert>
            ) : null}

            {/* Always rendered, also with nothing left to decide: the
                confirmation of the decision that emptied the list is
                shown by the form. */}
            <section aria-labelledby="findings-heading" className="space-y-4">
              <div className="space-y-1">
                <h2 id="findings-heading" className="text-lg font-semibold">
                  Findings to decide
                </h2>
                {review.findings.length > 0 ? (
                  <p className="max-w-prose text-sm text-[var(--color-muted-foreground)]">
                    Each line is a value found in the header of held images, where de-identification
                    normally leaves nothing. A finding is a warning, not a verdict: a code or a
                    shifted date is expected. Tick what identifies nobody and say why.
                  </p>
                ) : null}
                {review.totalFindings > review.findings.length ? (
                  <p className="text-sm text-[var(--color-muted-foreground)]">
                    Showing the first {review.findings.length} of {review.totalFindings}. The rest
                    appears once these are decided.
                  </p>
                ) : null}
              </div>
              <ReviewForm slug={review.datasetSlug} findings={review.findings} />
            </section>

            {review.decisions.length > 0 ? (
              <section aria-labelledby="decisions-heading" className="mt-10 space-y-3">
                <h2 id="decisions-heading" className="text-lg font-semibold">
                  Decisions recorded
                </h2>
                <ul className="space-y-3">
                  {review.decisions.map((decision) => (
                    <li
                      key={decision.id}
                      className="rounded-lg border border-[var(--color-border)] p-4"
                    >
                      <p className="text-xs text-[var(--color-muted-foreground)]">
                        <time dateTime={decision.decidedAt}>
                          {dateFmt.format(new Date(decision.decidedAt))}
                        </time>
                        {' · '}
                        {countOf(decision.acceptedFindingCount, 'finding', 'findings')} accepted
                      </p>
                      <p className="mt-1 max-w-prose whitespace-pre-wrap break-words text-sm">
                        {decision.reason}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </Section>
    </Container>
  );
}
