import type { HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn.js';

const badge = cva(
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
  {
    variants: {
      tone: {
        neutral:
          'bg-[var(--color-muted)] text-[var(--color-foreground)] ring-[var(--color-border)]',
        primary:
          'bg-[var(--color-primary-soft)] text-[var(--color-primary)] ring-[var(--color-primary)]/20',
        accent:
          'bg-[var(--color-accent-soft)] text-[var(--color-accent-foreground)] ring-[var(--color-accent)]/30',
        success:
          'bg-[var(--color-success-soft)] text-[var(--color-success)] ring-[var(--color-success)]/30',
        warning:
          'bg-[var(--color-warning-soft)] text-[var(--color-warning-foreground)] ring-[var(--color-warning)]/30',
        danger:
          'bg-[var(--color-danger-soft)] text-[var(--color-danger)] ring-[var(--color-danger)]/30',
        info: 'bg-[var(--color-info-soft)] text-[var(--color-info)] ring-[var(--color-info)]/30',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badge> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badge({ tone }), className)} {...props} />;
}
