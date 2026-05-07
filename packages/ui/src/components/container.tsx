import type { HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn.js';

const container = cva('mx-auto w-full px-4 sm:px-6', {
  variants: {
    size: {
      sm: 'max-w-2xl',
      md: 'max-w-3xl',
      lg: 'max-w-4xl',
      xl: 'max-w-5xl',
      page: 'max-w-6xl',
    },
  },
  defaultVariants: { size: 'page' },
});

export interface ContainerProps
  extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof container> {}

/**
 * Page-level horizontal gutter + max-width. Always use this around the
 * outermost section of a route — never a hand-rolled `mx-auto max-w-…`.
 */
export function Container({ className, size, ...props }: ContainerProps) {
  return <div className={cn(container({ size }), className)} {...props} />;
}

const section = cva('', {
  variants: {
    spacing: {
      none: '',
      sm: 'py-8',
      md: 'py-12',
      lg: 'py-16',
      hero: 'pt-16 pb-12 sm:pt-20 sm:pb-16',
    },
    surface: {
      none: '',
      hero: 'hero-surface',
      muted: 'bg-[var(--color-muted)]',
      subtle: 'bg-[var(--color-subtle)]',
    },
  },
  defaultVariants: { spacing: 'md', surface: 'none' },
});

export interface SectionProps extends HTMLAttributes<HTMLElement>, VariantProps<typeof section> {}

/**
 * Semantic `<section>` with consistent vertical rhythm and an optional
 * decorative surface. The hero variant overlays the radial wash from
 * `globals.css` so headlines get an anchor without bespoke gradients.
 */
export function Section({ className, spacing, surface, ...props }: SectionProps) {
  return <section className={cn(section({ spacing, surface }), className)} {...props} />;
}
