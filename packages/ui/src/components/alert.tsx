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

export function AlertTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h5 className={cn('mb-1 font-medium leading-none', className)} {...props} />;
}

export function AlertDescription({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('text-[var(--color-muted-foreground)]', className)} {...props} />;
}
