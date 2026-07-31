'use client';

import { useState } from 'react';
import { Alert, AlertDescription, AlertTitle, Button, Dialog, EyeIcon } from '@oci/ui';

interface Props {
  /** Filename shown in the row — also the dialog's accessible name. */
  filename: string;
  /**
   * The per-distribution download route the row's download link already
   * uses. It 302s to a short-lived presigned S3 URL, so the browser can
   * render it in an `<img>` without any new endpoint.
   */
  src: string;
  /** Rendered as the dialog's sub-line (content type · size). */
  meta: string;
}

/**
 * "preview" action for a hosted image distribution: opens the file
 * inline in a modal instead of making the researcher download 30 JPEGs
 * to find out which one they wanted.
 *
 * Only the trigger + dialog state live on the client; the row itself
 * stays in the server component. The dialog is mounted only while it's
 * open: a closed `<dialog>` is `display: none`, but the browser fetches
 * its `<img>` anyway, so keeping 30 of them mounted would mean 30
 * presigned-URL round trips on page load — and 30 copies of the
 * filename in the DOM. `Dialog` restores focus to the trigger on
 * unmount as well as on close, so this stays accessible.
 */
export function ImagePreviewButton({ filename, src, meta }: Props) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  function openPreview() {
    setLoaded(false);
    setFailed(false);
    setOpen(true);
  }

  return (
    <>
      <Button
        variant="link"
        size="sm"
        aria-haspopup="dialog"
        aria-label={`Preview ${filename}`}
        onClick={openPreview}
        className="h-11 px-2 sm:h-8"
      >
        <EyeIcon size={14} />
        <span>preview</span>
      </Button>

      {open ? (
        <Dialog
          open
          onClose={() => setOpen(false)}
          title={filename}
          description={meta}
          closeLabel={`Close preview of ${filename}`}
        >
          <div className="flex min-h-40 items-center justify-center">
            {failed ? (
              <Alert tone="danger" className="w-full">
                <AlertTitle as="h3">Preview unavailable</AlertTitle>
                <AlertDescription>
                  The image could not be loaded. It may need approved access, or the signed link may
                  have expired — try the download link instead.
                </AlertDescription>
              </Alert>
            ) : (
              <>
                {!loaded ? (
                  <p role="status" className="text-sm text-[var(--color-muted-foreground)]">
                    Loading preview…
                  </p>
                ) : null}
                {/*
                 * Plain <img>, not next/image: the source is a gated
                 * proxy route that redirects to a per-request presigned
                 * S3 URL, so there is nothing stable for the optimiser
                 * to cache or resize.
                 */}
                <img
                  src={src}
                  alt={`Preview of ${filename}`}
                  onLoad={() => setLoaded(true)}
                  onError={() => setFailed(true)}
                  className={
                    loaded
                      ? 'max-h-[70vh] max-w-full object-contain'
                      : // Kept in the tree so the fetch starts, hidden
                        // until it decodes so there's no half-painted
                        // image or layout jump.
                        'hidden'
                  }
                />
              </>
            )}
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
