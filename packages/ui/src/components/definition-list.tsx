import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn.js';

/**
 * Two-column term/value list with a stable label column on tablet+.
 *
 * Each item is a `<div>` inside the `<dl>` (HTML5 allows this) so it
 * can carry its own grid layout. We avoid putting the grid template on
 * the outer `<dl>` because Tailwind v4 wouldn't emit CSS for an
 * arbitrary value containing `max-content` (the keyword inside the
 * bracket pair fails to parse), leaving the grid silently un-styled.
 *
 * Container queries (not viewport queries) drive the breakpoint, so a
 * DefinitionList in a narrow card behaves correctly even when the
 * viewport is wide. The container needs `container-type: inline-size`
 * which Tailwind v4 emits via the `@container` utility.
 */
export function DefinitionList({ className, ...props }: HTMLAttributes<HTMLDListElement>) {
  return <dl className={cn('@container flex flex-col gap-3 text-sm', className)} {...props} />;
}

export interface DefinitionItemProps {
  term: ReactNode;
  children: ReactNode;
  /** Render value as monospaced text — useful for ids, ARNs, tokens. */
  mono?: boolean;
  className?: string;
}

export function DefinitionItem({ term, children, mono, className }: DefinitionItemProps) {
  return (
    <div className="grid gap-x-6 gap-y-1 @md:grid-cols-[9rem_1fr]">
      <dt className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)] @md:text-sm @md:normal-case @md:tracking-normal @md:pt-0.5">
        {term}
      </dt>
      <dd
        className={cn(
          'min-w-0 break-words text-[var(--color-foreground)]',
          mono && 'font-mono text-xs',
          className,
        )}
      >
        {children}
      </dd>
    </div>
  );
}
