'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription, AlertTitle, Button, Field, Input, Textarea } from '@oci/ui';
import type { ToolsetFormField, ToolsetFormValues } from '../../lib/toolset-form';
import type { ToolsetFormState } from './toolset-action-state';

/**
 * The toolset form (#830), for `/toolsets/new` and `/toolsets/[slug]/edit`.
 * One page, four groups: what it is, where it lives, who maintains it, what
 * it works with. On a refusal the action returns the values as typed and the
 * form is re-mounted with them.
 */

interface Props {
  mode: 'create' | 'edit';
  action: (prev: ToolsetFormState, formData: FormData) => Promise<ToolsetFormState>;
  initialValues: ToolsetFormValues;
  /** The kinds, labelled in the interface language on the server. */
  kinds: ReadonlyArray<{ value: string; label: string }>;
  /** Where "Cancel" leads. */
  cancelHref: string;
}

const initialState: ToolsetFormState = { status: 'idle' };

const SELECT_CLASS =
  'block h-10 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-base sm:text-sm text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]';

const HINTED: ReadonlySet<ToolsetFormField> = new Set([
  'slug',
  'summary',
  'url',
  'version',
  'licence',
  'maintainer',
  'contact',
  'datasetSlugs',
  'modelCardSlugs',
]);

export function ToolsetForm({ mode, action, initialValues, kinds, cancelHref }: Props) {
  const t = useTranslations('ToolsetForm');
  const tCommon = useTranslations('Common');
  const [state, formAction, pending] = useActionState(action, initialState);
  const values = state.status === 'error' && state.values ? state.values : initialValues;
  const fieldErrors = state.status === 'error' ? state.fieldErrors : undefined;
  const attempt = state.status === 'error' ? state.attempt : 0;

  /** A labelled text input for one field, with its hint and its error. */
  function text(
    name: Exclude<ToolsetFormField, 'kind' | 'summary'>,
    options: { required?: boolean; maxLength: number; readOnly?: boolean; type?: 'text' | 'url' },
  ) {
    const id = `ts-${name}`;
    const error = fieldErrors?.get(name);
    return (
      <Field
        label={t(`fields.${name}.label`)}
        htmlFor={id}
        required={options.required}
        requiredLabel={tCommon('required')}
        hint={HINTED.has(name) ? t(`fields.${name}.hint` as 'fields.slug.hint') : undefined}
        error={error}
      >
        <Input
          id={id}
          name={name}
          type={options.type ?? 'text'}
          required={options.required}
          readOnly={options.readOnly}
          // eslint-disable-next-line security/detect-object-injection -- closed key set
          defaultValue={values[name]}
          maxLength={options.maxLength}
          invalid={!!error}
          aria-describedby={error ? `${id}-err` : undefined}
          autoComplete="off"
        />
      </Field>
    );
  }

  const summaryError = fieldErrors?.get('summary');
  const kindError = fieldErrors?.get('kind');

  return (
    <form
      key={attempt}
      action={formAction}
      aria-busy={pending || undefined}
      className="max-w-3xl space-y-10"
    >
      {state.status === 'error' ? (
        <Alert tone="danger">
          <AlertTitle as="h2">{t('errorTitle')}</AlertTitle>
          <AlertDescription>
            <p>{state.message}</p>
            {fieldErrors && fieldErrors.size > 0 ? (
              <ul className="ms-4 mt-2 list-disc space-y-1 text-xs">
                {Array.from(fieldErrors.keys()).map((field) => (
                  <li key={field}>{t(`fields.${field}.label`)}</li>
                ))}
              </ul>
            ) : null}
            {state.otherErrors && state.otherErrors.length > 0 ? (
              <ul className="ms-4 mt-2 list-disc space-y-1 text-xs">
                {state.otherErrors.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <fieldset className="space-y-5">
        <legend className="text-lg font-semibold">{t('sectionWhat')}</legend>
        {text('slug', { required: true, maxLength: 80, readOnly: mode === 'edit' })}
        {text('name', { required: true, maxLength: 200 })}
        <Field label={t('fields.kind.label')} htmlFor="ts-kind" error={kindError}>
          <select id="ts-kind" name="kind" defaultValue={values.kind} className={SELECT_CLASS}>
            {kinds.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={t('fields.summary.label')}
          htmlFor="ts-summary"
          required
          requiredLabel={tCommon('required')}
          hint={t('fields.summary.hint')}
          error={summaryError}
        >
          <Textarea
            id="ts-summary"
            name="summary"
            required
            rows={4}
            minLength={20}
            maxLength={2000}
            defaultValue={values.summary}
            invalid={!!summaryError}
            aria-describedby={summaryError ? 'ts-summary-err' : undefined}
          />
        </Field>
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="text-lg font-semibold">{t('sectionWhere')}</legend>
        {text('url', { required: true, maxLength: 2000, type: 'url' })}
        <div className="grid gap-5 sm:grid-cols-2">
          {text('version', { maxLength: 50 })}
          {text('licence', { maxLength: 200 })}
        </div>
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="text-lg font-semibold">{t('sectionWho')}</legend>
        {text('maintainer', { required: true, maxLength: 200 })}
        {text('contact', { maxLength: 200 })}
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="text-lg font-semibold">{t('sectionLinks')}</legend>
        {text('datasetSlugs', { maxLength: 2000 })}
        {text('modelCardSlugs', { maxLength: 3000 })}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--color-border)] pt-6">
        <Button type="submit" size="lg" disabled={pending}>
          {mode === 'edit' ? t('saveEdit') : t('saveNew')}
        </Button>
        <Link
          href={cancelHref}
          className="rounded text-sm font-medium text-[var(--color-primary)] underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
        >
          {t('cancel')}
        </Link>
      </div>
    </form>
  );
}
