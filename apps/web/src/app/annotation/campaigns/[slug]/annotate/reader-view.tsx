'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@oci/ui';
import type { DicomView } from '@oci/shared-types';
import type { DicomViewRequest } from '../../../../../components/dicom-viewer/dicom-viewer';

interface ViewRequests {
  request: DicomViewRequest | null;
  show: (view: DicomViewRequest) => void;
}

const ViewRequestContext = createContext<ViewRequests | null>(null);

/**
 * Lets an arbiter show, in the task's DICOM viewer, the image and window
 * a reader answered on (#674). The page wraps a task in it; the readers'
 * answers ask, the viewer follows.
 */
export function ViewRequestProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<DicomViewRequest | null>(null);
  // A new object per request: the same view asked for twice is shown twice.
  const show = (view: DicomViewRequest) => setRequest({ ...view });
  return (
    <ViewRequestContext.Provider value={{ request, show }}>{children}</ViewRequestContext.Provider>
  );
}

/** For the viewer: the view last asked for, if any. */
export function useViewRequest(): DicomViewRequest | null {
  return useContext(ViewRequestContext)?.request ?? null;
}

/**
 * Where a reader was when they answered: the image by its place in the
 * series and the window, and a button that shows it in the viewer. The
 * image is named by position only, never by a DICOM UID.
 */
export function ReaderView({ view }: { view: DicomView }) {
  const t = useTranslations('DicomViewer');
  const show = useContext(ViewRequestContext)?.show;
  const parts = [
    t('readerView.summary', { position: view.position, count: view.imageCount }),
    ...(view.window
      ? [t('windowReadout', { width: view.window.width, center: view.window.center })]
      : []),
    ...(view.inverted ? [t('readerView.inverted')] : []),
  ];
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-[var(--color-muted-foreground)]">{parts.join(' · ')}</span>
      {show ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            show({ position: view.position, window: view.window, inverted: view.inverted })
          }
        >
          {t('readerView.show', { position: view.position })}
        </Button>
      ) : null}
    </div>
  );
}
