'use client';

import dynamic from 'next/dynamic';
import type { DicomViewerProps } from './dicom-viewer';

/**
 * The DICOM viewer, fetched when it is first shown.
 *
 * The rendering library and its decoders are about 0.9 MB of script,
 * and they need a browser (canvas, workers, WebAssembly). Loading them
 * on demand keeps them off every page that does not open a series, and
 * out of server rendering altogether.
 */
const LazyDicomViewer = dynamic(() => import('./dicom-viewer').then((m) => m.DicomViewer), {
  ssr: false,
  loading: () => (
    <p
      role="status"
      className="flex h-[min(calc(100dvh-24rem),44rem)] min-h-64 items-center justify-center rounded-md bg-black text-sm text-white"
    >
      Loading the viewer…
    </p>
  ),
});

export function DicomViewerLoader(props: DicomViewerProps) {
  return <LazyDicomViewer {...props} />;
}
