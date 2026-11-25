'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Field } from '@oci/ui';
import type { ModelCardOption } from './model-card-choice';

const SELECT_CLASS =
  'block h-10 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-base sm:text-sm text-[var(--color-foreground)] aria-[invalid=true]:border-[var(--color-danger)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]';

const LINK =
  'rounded font-medium text-[var(--color-primary)] underline underline-offset-2 hover:text-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]';

/**
 * The model card picker (#587), on the submit page and on the submission
 * page: "No model card" first, then the caller's linkable cards with their
 * version and status, a draft saying it is one.
 *
 * With no card to offer it is not an empty list but a line pointing to
 * `/models/new`. With the list unreadable (`options === null`) it says so;
 * the submission can still go ahead without a card.
 *
 * Text: `EvaluationSubmit.modelCard`.
 */
export function ModelCardPicker({
  id,
  label,
  options,
  defaultValue,
  hint,
  error,
  invalid,
  className,
}: {
  id: string;
  /** The select's label, when the page around it already says "Model card". */
  label?: string;
  /** `null` when the caller's cards could not be read. */
  options: readonly ModelCardOption[] | null;
  /** The card id to show selected; `''` for "No model card". */
  defaultValue: string;
  hint: string;
  /** Shown under the picker, and linked to it. */
  error?: string;
  /** Marks the picker invalid when the error is shown elsewhere (an alert). */
  invalid?: boolean;
  className?: string;
}) {
  const t = useTranslations('EvaluationSubmit');

  if (options === null) {
    return (
      <ModelCardNote id={id} label={t('modelCard.label')}>
        {t('modelCard.unavailable')}
      </ModelCardNote>
    );
  }
  if (options.length === 0) {
    return (
      <ModelCardNote id={id} label={t('modelCard.label')}>
        {t.rich('modelCard.noCards', {
          link: (chunks) => (
            <Link href="/models/new" className={LINK}>
              {chunks}
            </Link>
          ),
        })}
      </ModelCardNote>
    );
  }

  return (
    <Field
      label={label ?? t('modelCard.label')}
      htmlFor={id}
      hint={hint}
      error={error}
      className={className}
    >
      <select
        // A new default (after a save, or an echoed choice) must show.
        key={defaultValue}
        id={id}
        name="modelCardId"
        defaultValue={defaultValue}
        aria-invalid={error || invalid ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        className={SELECT_CLASS}
      >
        <option value="">{t('modelCard.none')}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {t('modelCard.option', { slug: o.slug, version: o.version, status: o.status })}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** The picker's place when there is nothing to pick: its label, and why. */
function ModelCardNote({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5" id={id}>
      <p className="text-sm font-medium">{label}</p>
      <p className="text-sm text-[var(--color-muted-foreground)]">{children}</p>
    </div>
  );
}
