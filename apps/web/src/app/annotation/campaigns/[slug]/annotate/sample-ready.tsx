'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

interface SampleReady {
  ready: boolean;
  setReady: (ready: boolean) => void;
}

const SampleReadyContext = createContext<SampleReady | null>(null);

/**
 * Whether the task's image is on screen (#646 review, item 5). The
 * viewer reports it and the answer form reads it, so a reader cannot
 * submit before the image has loaded, or after it failed to.
 *
 * The page wraps a task with a hosted sample in this provider. Without
 * one (a task whose sample is only a reference) there is nothing to
 * wait for and the form is always ready.
 */
export function SampleReadyProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  return (
    <SampleReadyContext.Provider value={{ ready, setReady }}>
      {children}
    </SampleReadyContext.Provider>
  );
}

/** True once the sample is on screen, or when there is no sample to wait for. */
export function useSampleReady(): boolean {
  return useContext(SampleReadyContext)?.ready ?? true;
}

/** For a viewer: report whether its sample is on screen now. */
export function useReportSampleReady(ready: boolean): void {
  const setReady = useContext(SampleReadyContext)?.setReady;
  useEffect(() => {
    setReady?.(ready);
  }, [setReady, ready]);
}
