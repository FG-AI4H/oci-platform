'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import type { RowBreakpoint } from './site-header-links';

// Whole class names, so Tailwind finds them in the source.
function hideFromClass(breakpoint: RowBreakpoint): string {
  switch (breakpoint) {
    case 'xl':
      return 'xl:hidden';
    case '2xl':
      return '2xl:hidden';
    case 'never':
      return '';
  }
}

/**
 * The header's navigation below the `xl` breakpoint (#743), or below
 * `2xl` or at every width when a caller's links need it (#776): a
 * disclosure instead of a row of links that runs into the account area
 * at tablet width, French labels being the longest. A native
 * `<details>`, so it opens without script; the script only closes it
 * once a link has been followed, since the header stays mounted across
 * navigations.
 */
export function HeaderMenu({
  label,
  hideFrom,
  children,
}: {
  label: string;
  /** The breakpoint from which the header shows its links in a row instead. */
  hideFrom: RowBreakpoint;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);

  useEffect(() => {
    const close = (event: KeyboardEvent | MouseEvent) => {
      const details = ref.current;
      if (!details?.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return;
        details.open = false;
        details.querySelector('summary')?.focus();
        return;
      }
      if (event.target instanceof Node && !details.contains(event.target)) details.open = false;
    };
    document.addEventListener('keydown', close);
    document.addEventListener('click', close);
    return () => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('click', close);
    };
  }, []);

  return (
    <details ref={ref} className={`group relative ${hideFromClass(hideFrom)}`}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1.5 text-sm font-medium text-[var(--color-foreground)] hover:bg-[var(--color-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] [&::-webkit-details-marker]:hidden">
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        >
          <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
        </svg>
        {label}
      </summary>
      <div className="absolute right-0 top-full z-40 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-2 shadow-lg">
        {children}
      </div>
    </details>
  );
}
