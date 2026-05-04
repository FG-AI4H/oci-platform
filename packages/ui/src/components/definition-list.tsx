import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export function DefinitionList({ className, ...props }: HTMLAttributes<HTMLDListElement>) {
  return (
    <dl
      className={cn(
        'grid grid-cols-1 sm:grid-cols-[max-content_1fr] gap-x-6 gap-y-2.5 text-sm',
        className,
      )}
      {...props}
    />
  );
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
    <>
      <dt className="font-medium text-[var(--color-muted-foreground)]">{term}</dt>
      <dd
        className={cn(
          'text-[var(--color-foreground)] break-all',
          mono && 'font-mono text-xs',
          className,
        )}
      >
        {children}
      </dd>
    </>
  );
}
