import { forwardRef } from 'react';
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { cn } from '../lib/cn.js';

const baseField =
  'w-full rounded-md border bg-[var(--color-card)] px-3 text-base sm:text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] disabled:cursor-not-allowed disabled:opacity-60';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Visual error state — shows the danger ring without changing semantics. */
  invalid?: boolean;
  /** Slot for an icon rendered inside the start of the input. */
  leadingIcon?: ReactNode;
  /** Slot for an icon rendered inside the end of the input. */
  trailingIcon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, leadingIcon, trailingIcon, ...rest },
  ref,
) {
  if (leadingIcon || trailingIcon) {
    return (
      <div
        className={cn(
          'flex items-center rounded-md border bg-[var(--color-card)] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--color-ring)]',
          invalid ? 'border-[var(--color-danger)]' : 'border-[var(--color-border)]',
        )}
      >
        {leadingIcon ? (
          <span className="ps-3 text-[var(--color-muted-foreground)]">{leadingIcon}</span>
        ) : null}
        <input
          ref={ref}
          className={cn(
            'flex-1 h-10 bg-transparent px-3 text-base sm:text-sm placeholder:text-[var(--color-muted-foreground)] focus:outline-none',
            className,
          )}
          {...rest}
        />
        {trailingIcon ? (
          <span className="pe-3 text-[var(--color-muted-foreground)]">{trailingIcon}</span>
        ) : null}
      </div>
    );
  }
  return (
    <input
      ref={ref}
      className={cn(
        baseField,
        'h-10',
        invalid ? 'border-[var(--color-danger)]' : 'border-[var(--color-border)]',
        className,
      )}
      {...rest}
    />
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  /** Apply mono font + tighter sizing for code/JSON-LD blobs. */
  mono?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, mono, rows = 4, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        baseField,
        'py-2',
        mono && 'font-mono text-xs sm:text-xs',
        invalid ? 'border-[var(--color-danger)]' : 'border-[var(--color-border)]',
        className,
      )}
      {...rest}
    />
  );
});
