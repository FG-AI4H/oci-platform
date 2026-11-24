'use client';

import { Button, DownloadIcon } from '@oci/ui';

/**
 * Opens the browser's print dialog, which is also how the summary becomes a
 * PDF (#652): there is no server-side rendering. The label comes from the
 * server component, so no message namespace travels to the browser for it.
 */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button type="button" variant="primary" onClick={() => window.print()}>
      <DownloadIcon size={16} aria-hidden="true" />
      {label}
    </Button>
  );
}
