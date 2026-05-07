import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface FieldProps {
  /** Visible label rendered as a `<label htmlFor>` over the control. */
  label: ReactNode;
  /** The id of the control inside `children`. Pass it via `htmlFor` so
   *  screen readers associate the label even when the control isn't a
   *  direct child (e.g. the input is wrapped by an icon container). */
  htmlFor: string;
  /** Optional helper copy shown when there's no error. */
  hint?: ReactNode;
  /** Inline error message. When present we route the helper-paragraph
   *  id into `aria-describedby` of the control via `errorId`. */
  error?: ReactNode;
  /** Mark the field as required. Renders a discreet asterisk inside the
   *  label and propagates `required` to the underlying control via the
   *  caller. (We don't auto-clone — the control is opaque here.) */
  required?: boolean;
  /** The control: `<Input>`, `<Textarea>`, or any custom control. */
  children: ReactNode;
  className?: string;
}

/**
 * Standard label/control/hint/error stack used by every form on the
 * platform. Replaces the duplicated `Field()` helpers that used to live
 * in each form file.
 *
 * Usage:
 *
 *   <Field label="Slug" htmlFor="slug" hint="…" error={errors.slug}>
 *     <Input id="slug" name="slug" required invalid={!!errors.slug}
 *            aria-describedby={errors.slug ? 'slug-err' : undefined} />
 *   </Field>
 */
export function Field({ label, htmlFor, hint, error, required, children, className }: FieldProps) {
  const errId = error ? `${htmlFor}-err` : undefined;
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
        {required ? (
          <span aria-hidden="true" className="ms-0.5 text-[var(--color-danger)]">
            *
          </span>
        ) : null}
        {required ? <span className="sr-only"> required</span> : null}
      </label>
      {children}
      {hint && !error ? (
        <p className="text-xs text-[var(--color-muted-foreground)]">{hint}</p>
      ) : null}
      {error ? (
        <p id={errId} className="text-xs text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
