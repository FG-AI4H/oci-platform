'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, DownloadIcon } from '@oci/ui';
import { useFormatters } from '../../../i18n/client';

export interface BulkDownloadProps {
  slug: string;
  /** Files the archive will contain: platform-hosted and not access-gated. */
  includedCount: number;
  /** Excluded because they need an approved access request. */
  gatedCount: number;
  /** Excluded because the original publisher hosts the bytes. */
  upstreamCount: number;
  /** Every distribution in the latest published version. */
  totalCount: number;
  /**
   * Pre-formatted sum of the declared sizes of the included files, or
   * `null` when none of them declares one. Formatted server-side so
   * there's one byte formatter on the page.
   */
  sizeLabel: string | null;
  /** Included files whose manifest declares no size. */
  unknownSizeCount: number;
}

/**
 * "Download all" for a dataset — one ZIP from
 * `GET /v2/catalog/datasets/:slug/download`, proxied through the web
 * app's own `/catalog/:slug/download` route so the browser's plain
 * navigation carries the caller's session (same shape as the
 * per-distribution download link).
 *
 * The API's eligibility rule (latest published version, bytes held by
 * the platform, not individually access-gated) is mirrored here as
 * counts so the page can say what the archive holds and what it leaves
 * out *before* the click — and can suppress the control entirely rather
 * than offer a download that would 409.
 *
 * Deliberately a plain anchor, not a fetch: the archive is streamed and
 * can be large, so the browser's own download manager should own it.
 * That also means there is no pending state to get stuck in — the click
 * hands off to the browser and this component is done.
 */
export function BulkDownload({
  slug,
  includedCount,
  gatedCount,
  upstreamCount,
  totalCount,
  sizeLabel,
  unknownSizeCount,
}: BulkDownloadProps) {
  const t = useTranslations('Dataset');
  const f = useFormatters();
  const [includeManifest, setIncludeManifest] = useState(false);
  const detailsId = useId();
  const checkboxId = useId();

  // Whole sentences per branch rather than assembled fragments — only
  // the numbers are interpolated, so these stay translatable as units.
  const gatedSentence = (n: number) => t('bulk.gated', { count: n });
  const upstreamSentence = (n: number) => t('bulk.upstream', { count: n });

  if (includedCount === 0) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-subtle)] p-4 text-sm">
        <p className="font-medium text-[var(--color-foreground)]">{t('bulk.noArchiveTitle')}</p>
        <p className="mt-1 text-[var(--color-muted-foreground)]">
          {t('bulk.noArchiveBody')} {gatedCount > 0 ? gatedSentence(gatedCount) : null}{' '}
          {upstreamCount > 0 ? upstreamSentence(upstreamCount) : null}
        </p>
      </div>
    );
  }

  const excluded = gatedCount + upstreamCount;
  const size = sizeLabel === null ? '' : t('bulk.sizeSuffix', { size: sizeLabel });
  const includedSentence =
    totalCount === 1
      ? t('bulk.includedOnly', { size })
      : includedCount === totalCount
        ? t('bulk.includedAll', { total: f.number(totalCount), size })
        : t('bulk.includedSome', {
            included: f.number(includedCount),
            total: f.number(totalCount),
            size,
          });

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-subtle)] p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1 text-sm" id={detailsId}>
          <p className="font-medium text-[var(--color-foreground)]">{t('bulk.title')}</p>
          <p className="text-[var(--color-muted-foreground)]">
            {includedSentence}{' '}
            {unknownSizeCount > 0 ? t('bulk.unknownSize', { count: unknownSizeCount }) : null}
          </p>
          <p className="text-[var(--color-muted-foreground)]">{t('bulk.licenceNote')}</p>
          {excluded > 0 ? (
            <p className="text-[var(--color-muted-foreground)]">
              {t('bulk.notIncluded')} {gatedCount > 0 ? gatedSentence(gatedCount) : null}{' '}
              {upstreamCount > 0 ? upstreamSentence(upstreamCount) : null}
            </p>
          ) : null}
        </div>

        <Button asChild className="h-11 w-full shrink-0 sm:h-9 sm:w-auto">
          {/* Plain anchor: `Content-Disposition: attachment` on the
              response means the browser downloads without navigating,
              and an error response stays visible instead of being
              saved as a file (which a `download` attribute would do). */}
          <a
            href={`/catalog/${encodeURIComponent(slug)}/download?manifest=${includeManifest ? 'true' : 'false'}`}
            aria-describedby={detailsId}
          >
            <DownloadIcon size={16} />
            <span>{t('bulk.downloadAll')}</span>
          </a>
        </Button>
      </div>

      <label
        htmlFor={checkboxId}
        className="mt-3 flex min-h-11 cursor-pointer items-center gap-2 text-sm sm:min-h-0"
      >
        <input
          id={checkboxId}
          type="checkbox"
          checked={includeManifest}
          onChange={(e) => setIncludeManifest(e.target.checked)}
          className="h-4 w-4 cursor-pointer accent-[var(--color-primary)]"
        />
        <span>
          {t('bulk.includeMetadata')}
          <span className="ms-2 text-xs text-[var(--color-muted-foreground)]">
            {t('bulk.includeMetadataHint')}
          </span>
        </span>
      </label>
    </div>
  );
}
