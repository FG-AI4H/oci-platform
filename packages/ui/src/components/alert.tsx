import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn.js';

const alert = cva('rounded-lg border p-4 text-sm', {
  variants: {
    tone: {
      info: 'border-[var(--color-info)]/30 bg-[var(--color-info-soft)] text-[var(--color-foreground)]',
      success:
        'border-[var(--color-success)]/30 bg-[var(--color-success-soft)] text-[var(--color-foreground)]',
      warning:
        'border-[var(--color-warning)]/40 bg-[var(--color-warning-soft)] text-[var(--color-foreground)]',
      danger:
        'border-[var(--color-danger)]/40 bg-[var(--color-danger-soft)] text-[var(--color-foreground)]',
    },
  },
  defaultVariants: { tone: 'info' },
});

export interface AlertProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof alert> {}

export const Alert = forwardRef<HTMLDivElement, AlertProps>(
  ({ className, tone, ...props }, ref) => (
    <div ref={ref} role="alert" className={cn(alert({ tone }), className)} {...props} />
  ),
);
Alert.displayName = 'Alert';

type HeadingLevel = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

export interface AlertTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  /**
   * Heading level of the title. Defaults to `h5` to match the
   * pre-existing visual treatment, but should be overridden when the
   * Alert is the most prominent heading on the screen — leaving it as
   * h5 then violates WCAG 1.3.1 "Info and Relationships" by skipping
   * h2/h3/h4 above it.
   */
  as?: HeadingLevel;
}

export function AlertTitle({ as: As = 'h5', className, ...props }: AlertTitleProps) {
  return <As className={cn('mb-1 font-medium leading-none', className)} {...props} />;
}

export function AlertDescription({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('text-[var(--color-muted-foreground)]', className)} {...props} />;
}
