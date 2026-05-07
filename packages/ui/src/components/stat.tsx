import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface StatProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  value: ReactNode;
  /** Optional supporting copy under the value (e.g. units or trend). */
  hint?: ReactNode;
  /** Optional small icon placed next to the value. */
  icon?: ReactNode;
}

/**
 * Headline number + label, used for "3 datasets curated", "Croissant 1.1
 * native", etc. Kept restrained — this is a research platform, not a
 * landing page. Icon is decorative; tone comes from typography weight.
 */
export function Stat({ label, value, hint, icon, className, ...rest }: StatProps) {
  return (
    <div className={cn('flex flex-col gap-1', className)} {...rest}>
      <div className="flex items-baseline gap-2">
        {icon ? (
          <span className="text-[var(--color-primary)]" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <span className="text-3xl font-semibold tracking-tight tabular-nums text-[var(--color-foreground)]">
          {value}
        </span>
      </div>
      <div className="text-sm font-medium text-[var(--color-muted-foreground)]">{label}</div>
      {hint ? <div className="text-xs text-[var(--color-muted-foreground)]/80">{hint}</div> : null}
    </div>
  );
}
