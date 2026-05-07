import { Children, cloneElement, forwardRef, isValidElement } from 'react';
import type { ButtonHTMLAttributes, ReactElement } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn.js';

const button = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary:
          'bg-[var(--color-primary)] text-[var(--color-primary-foreground)] shadow-[var(--shadow-sm)] hover:bg-[var(--color-primary-hover)]',
        secondary:
          'bg-[var(--color-card)] text-[var(--color-foreground)] border border-[var(--color-border)] shadow-[var(--shadow-xs)] hover:bg-[var(--color-muted)]',
        outline:
          'border border-[var(--color-primary)] text-[var(--color-primary)] hover:bg-[var(--color-primary-soft)]',
        ghost: 'text-[var(--color-foreground)] hover:bg-[var(--color-muted)]',
        link: 'text-[var(--color-primary)] underline-offset-4 hover:underline',
        danger:
          'bg-[var(--color-danger)] text-[var(--color-danger-foreground)] shadow-[var(--shadow-sm)] hover:opacity-90',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-9 px-4',
        lg: 'h-11 px-6 text-base',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {
  /** Render the child element with button styling instead of wrapping
   *  it in a `<button>`. Useful for next/link `<Link>` so the link is
   *  the focusable element (correct semantics + keyboard behaviour). */
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { asChild, className, variant, size, children, ...props },
  ref,
) {
  const classes = cn(button({ variant, size }), className);

  if (asChild && isValidElement(children)) {
    const child = Children.only(children) as ReactElement<{ className?: string }>;
    return cloneElement(child, {
      ...props,
      className: cn(classes, child.props.className),
      // ref forwarding to the child is best-effort — most consumers
      // (next/link) accept ref via plain attribute merging.
      ...({ ref } as object),
    });
  }
  return (
    <button ref={ref} className={classes} {...props}>
      {children}
    </button>
  );
});

export { button as buttonVariants };
