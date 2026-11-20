'use client';

import { useCallback, useState } from 'react';
import type { DicomSeriesDetail } from '@oci/shared-types';
import { Button, Dialog, EyeIcon } from '@oci/ui';
import { DicomViewerLoader } from '../../../components/dicom-viewer/dicom-viewer-loader';

interface Props {
  slug: string;
  seriesId: string;
  /** Shown in the row; also the dialog's accessible name. */
  title: string;
  /** Rendered as the dialog's sub-line (image count · size). */
  meta: string;
}

/**
 * "view" action for a DICOM series on the dataset page: opens the
 * series in the built-in viewer, in a dialog, without downloading it.
 *
 * Only the trigger and the dialog state live on the client; the list
 * of series stays in the server component. The viewer is mounted only
 * while the dialog is open, so nothing is fetched from storage, and
 * none of the viewer's script is loaded, until a reader asks for it.
 */
export function SeriesViewButton({ slug, seriesId, title, meta }: Props) {
  const [open, setOpen] = useState(false);

  // Through the web app, not the API directly: the route handler adds
  // the reader's access token, which the browser does not hold.
  const loadSeries = useCallback(async (): Promise<DicomSeriesDetail> => {
    const res = await fetch(`/catalog/${slug}/dicom/series/${seriesId}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`series request failed with ${res.status}`);
    return (await res.json()) as DicomSeriesDetail;
  }, [slug, seriesId]);

  return (
    <>
      <Button
        variant="link"
        size="sm"
        aria-haspopup="dialog"
        aria-label={`View ${title}`}
        onClick={() => setOpen(true)}
        className="h-11 px-2 sm:h-8"
      >
        <EyeIcon size={14} />
        <span>view</span>
      </Button>

      {open ? (
        <Dialog
          open
          onClose={() => setOpen(false)}
          title={title}
          description={meta}
          closeLabel={`Close ${title}`}
          className="max-w-5xl"
        >
          <DicomViewerLoader loadSeries={loadSeries} label={title} />
        </Dialog>
      ) : null}
    </>
  );
}
