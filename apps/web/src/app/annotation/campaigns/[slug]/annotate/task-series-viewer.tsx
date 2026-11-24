'use client';

import { useCallback, useRef, useState } from 'react';
import type { DicomSeriesSample, DicomView, DicomViewerSeries } from '@oci/shared-types';
import { DicomViewerLoader } from '../../../../../components/dicom-viewer/dicom-viewer-loader';
import { useReportSampleReady } from './sample-ready';

interface TaskSeriesViewerProps {
  assignmentId: string;
  /** The series as the page loaded it; used for the first draw. */
  initial: DicomSeriesSample;
  /** Names the series for assistive technology. */
  label: string;
  /** The id of the answer form, which the `view` field joins. */
  formId: string;
}

/**
 * The task's DICOM series in the built-in viewer (#674), on the annotate
 * and arbitration screens.
 *
 * The page passes the series it loaded, so the first draw needs no
 * second request. When the addresses expire the viewer asks again, and
 * this fetches the sample afresh through the web app.
 *
 * What the viewer has on screen goes into the answer as its optional
 * `view` (#646): a hidden field outside the form, joined to it by the
 * `form` attribute. Empty while the picture is not the image asked for.
 */
export function TaskSeriesViewer({ assignmentId, initial, label, formId }: TaskSeriesViewerProps) {
  const first = useRef<DicomSeriesSample | null>(initial);
  const [view, setView] = useState<DicomView | null>(null);
  // The image asked for is drawn once there is a view: until then the
  // answer form keeps Submit disabled (#646 review, item 5).
  useReportSampleReady(view !== null);

  const loadSeries = useCallback(async (): Promise<DicomViewerSeries> => {
    const fresh = first.current;
    first.current = null;
    if (fresh && Date.parse(fresh.expiresAt) > Date.now() + 30_000) return fresh;
    const res = await fetch(`/annotation/assignments/${assignmentId}/sample`, {
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`sample request failed with ${res.status}`);
    const body = (await res.json()) as { kind?: string } & Partial<DicomSeriesSample>;
    if (body.kind !== 'dicom-series') throw new Error('the sample is not a series');
    return body as DicomSeriesSample;
  }, [assignmentId]);

  return (
    <div>
      <DicomViewerLoader
        loadSeries={loadSeries}
        label={label}
        onViewChange={setView}
        context="task"
      />
      <input type="hidden" name="view" form={formId} value={view ? JSON.stringify(view) : ''} />
    </div>
  );
}
