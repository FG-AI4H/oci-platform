'use client';

import { useEffect } from 'react';

const INTERACTIONS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart'];

/**
 * Tells the server that someone is using the page (#643).
 *
 * The session ends after a period without activity, and activity is
 * what reaches the server. Reading an image or writing in a form sends
 * nothing, so this reports it: when the user moves the pointer, presses
 * a key, scrolls or touches, and the last report is older than
 * `reportEverySeconds`, it posts once to `/api/session/activity`.
 *
 * There is no timer. A page nobody touches sends nothing, however long
 * it stays open, and its session runs out like any other. Events made
 * by a script do not count.
 *
 * Renders nothing.
 */
export function SessionActivity({ reportEverySeconds }: { reportEverySeconds: number }) {
  useEffect(() => {
    // The request that rendered this page already counted.
    let lastReportMs = Date.now();
    let reporting = false;
    // Set once the server says the session is over: nothing left to
    // keep alive. (Telling the user at that moment is not built yet.)
    let ended = false;

    const onInteraction = (event: Event) => {
      if (!event.isTrusted || reporting || ended) return;
      if (Date.now() - lastReportMs < reportEverySeconds * 1000) return;
      reporting = true;
      fetch('/api/session/activity', { method: 'POST', cache: 'no-store', keepalive: true })
        .then((response) => {
          ended = response.status === 401;
        })
        .catch(() => undefined)
        .finally(() => {
          lastReportMs = Date.now();
          reporting = false;
        });
    };

    const options = { capture: true, passive: true };
    for (const type of INTERACTIONS) window.addEventListener(type, onInteraction, options);
    return () => {
      for (const type of INTERACTIONS) window.removeEventListener(type, onInteraction, options);
    };
  }, [reportEverySeconds]);

  return null;
}
