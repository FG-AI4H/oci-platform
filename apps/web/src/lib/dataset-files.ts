import type { Distribution } from '@oci/shared-types';

/**
 * Helpers for the "Files" card on the dataset detail page: which
 * distributions the platform actually holds, which ones can be
 * previewed inline, and what a "Download all" would and wouldn't
 * contain.
 *
 * Extracted from the page so the archive's scope — the claim the UI
 * makes about what a researcher is getting — is unit-testable.
 */

/**
 * Platform-hosted distributions get a relative `contentUrl` of
 * `/v2/catalog/datasets/<slug>/distributions/<id>/download` (set by
 * StorageService.completeUpload). Upstream URLs are absolute. The gate
 * is the relative-path discriminator, not a parse — keeps the contract
 * cheap on both halves.
 */
export function isPlatformHosted(contentUrl: string | null): boolean {
  if (!contentUrl) return false;
  return contentUrl.startsWith('/v2/catalog/');
}

/**
 * Whether a distribution can be shown inline. Three conditions, all
 * necessary: the platform holds the bytes (so there's a same-origin,
 * session-authenticated URL to point an `<img>` at), the file isn't
 * individually access-gated (a preview would 403 — and shouldn't be
 * offered), and it declares an image content type. Anything else — CSV,
 * DICOM, NIfTI, ZIP — gets no preview action.
 */
export function isPreviewableImage(d: Distribution): boolean {
  return isPlatformHosted(d.contentUrl) && !d.requiresAccess && d.contentType.startsWith('image/');
}

export interface BulkDownloadSummary {
  /** Rows the archive will contain. */
  includedCount: number;
  /** Rows left out because they need an approved access request. */
  gatedCount: number;
  /** Rows left out because the original publisher holds the bytes. */
  upstreamCount: number;
  totalCount: number;
  /** Sum of declared sizes across the included rows. */
  knownBytes: number;
  /** Included rows whose manifest declares no size. */
  unknownSizeCount: number;
}

/**
 * Mirror of `BulkDownloadService.plan()`'s eligibility rule, computed
 * from the detail response rather than a second API call.
 *
 * The API includes a distribution when it belongs to the latest
 * published version AND `storageBackend=S3` AND `uploadStatus=READY`
 * AND `requiresAccess=false`. `detail.distributions` is already scoped
 * to the latest version (see CatalogRepository.findBySlug), and the
 * relative `/v2/catalog/…` contentUrl is only ever written for a READY
 * S3 row by `StorageService.completeUpload` — so `isPlatformHosted`
 * stands in for the two storage columns, which the API deliberately
 * doesn't expose.
 *
 * The three buckets are mutually exclusive and sum to `totalCount`, so
 * no file is silently dropped from the explanation: access-gated first
 * (that's the reason the requester can act on), then upstream-hosted,
 * then everything left is in the archive.
 */
export function summariseBulkDownload(distributions: Distribution[]): BulkDownloadSummary {
  let includedCount = 0;
  let gatedCount = 0;
  let upstreamCount = 0;
  let knownBytes = 0;
  let unknownSizeCount = 0;

  for (const d of distributions) {
    if (d.requiresAccess) {
      gatedCount += 1;
      continue;
    }
    if (!isPlatformHosted(d.contentUrl)) {
      upstreamCount += 1;
      continue;
    }
    includedCount += 1;
    if (d.contentSizeBytes === null) unknownSizeCount += 1;
    else knownBytes += d.contentSizeBytes;
  }

  return {
    includedCount,
    gatedCount,
    upstreamCount,
    totalCount: distributions.length,
    knownBytes,
    unknownSizeCount,
  };
}
