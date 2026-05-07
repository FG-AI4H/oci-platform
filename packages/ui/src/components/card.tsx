import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn.js';

const card = cva(
  'rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-card-foreground)] shadow-[var(--shadow-sm)] transition-shadow',
  {
    variants: {
      tone: {
        default: '',
        elevated: 'bg-[var(--color-elevated)] shadow-[var(--shadow-md)]',
        subtle: 'bg-[var(--color-subtle)]',
      },
      interactive: {
        none: '',
        hover: 'hover:shadow-[var(--shadow-md)]',
      },
      accent: {
        none: '',
        primary: 'border-t-2 border-t-[var(--color-primary)]',
        accent: 'border-t-2 border-t-[var(--color-accent)]',
        success: 'border-t-2 border-t-[var(--color-success)]',
        warning: 'border-t-2 border-t-[var(--color-warning)]',
        danger: 'border-t-2 border-t-[var(--color-danger)]',
        info: 'border-t-2 border-t-[var(--color-info)]',
        'phase-a': 'border-t-2 border-t-[var(--color-phase-a)]',
        'phase-b': 'border-t-2 border-t-[var(--color-phase-b)]',
        'phase-c': 'border-t-2 border-t-[var(--color-phase-c)]',
        'phase-d': 'border-t-2 border-t-[var(--color-phase-d)]',
      },
    },
    defaultVariants: { tone: 'default', interactive: 'none', accent: 'none' },
  },
);

export interface CardProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof card> {}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, tone, interactive, accent, ...props },
  ref,
) {
  return (
    <div ref={ref} className={cn(card({ tone, interactive, accent }), className)} {...props} />
  );
});

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-1.5 p-6 pb-4', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('text-lg font-semibold leading-tight tracking-tight', className)}
      {...props}
    />
  ),
);
CardTitle.displayName = 'CardTitle';

export const CardDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn('text-sm leading-relaxed text-[var(--color-muted-foreground)]', className)}
    {...props}
  />
));
CardDescription.displayName = 'CardDescription';

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
  ),
);
CardContent.displayName = 'CardContent';

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex items-center justify-between gap-4 border-t border-[var(--color-border)] p-6 pt-4',
        className,
      )}
      {...props}
    />
  ),
);
CardFooter.displayName = 'CardFooter';
