import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn.js';

const iconButton = cva(
  'inline-flex items-center justify-center rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        ghost:
          'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-muted)]',
        outline:
          'border border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-muted)]',
      },
      size: {
        sm: 'h-8 w-8',
        md: 'h-9 w-9',
        lg: 'h-11 w-11',
      },
    },
    defaultVariants: { variant: 'ghost', size: 'md' },
  },
);

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof iconButton> {
  /** Required label — read by screen readers because there's no visible text. */
  label: string;
  children: ReactNode;
}

/**
 * Square button containing only an icon. The `label` prop is required
 * and becomes the accessible name (no visible text, so we can't infer
 * one). Use for quiet UI affordances — close, copy, more — not for
 * primary calls to action.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, variant, size, label, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      className={cn(iconButton({ variant, size }), className)}
      {...rest}
    >
      {children}
    </button>
  );
});
