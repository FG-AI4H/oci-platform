'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription, AlertTitle, Button, Field, Input, Textarea } from '@oci/ui';
import { createDatasetAction, type CreateDatasetState } from './actions';

const initial: CreateDatasetState = { status: 'idle' };

type Visibility = 'PRIVATE' | 'RESTRICTED' | 'PUBLIC';

// Titles and hints are in the `CatalogNew` messages (`form.visibility.*`).
const VISIBILITY_OPTIONS: ReadonlyArray<Visibility> = ['PRIVATE', 'RESTRICTED', 'PUBLIC'];

export function NewDatasetForm() {
  const t = useTranslations('CatalogNew');
  const tCommon = useTranslations('Common');
  const [state, action, pending] = useActionState(createDatasetAction, initial);
  const echoed = state.status === 'error' ? state.values : undefined;
  const visibilityDefault: Visibility =
    echoed?.visibility === 'RESTRICTED' || echoed?.visibility === 'PUBLIC'
      ? echoed.visibility
      : 'PRIVATE';

  const slugError = fieldError(state, 'slug');
  const nameError = fieldError(state, 'name');
  const descError = fieldError(state, 'description');

  return (
    <form action={action} className="space-y-5" aria-busy={pending || undefined}>
      {state.status === 'error' ? (
        <Alert tone="danger">
          <AlertTitle>{t('form.errorTitle')}</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <Field
        label={t('form.slugLabel')}
        htmlFor="field-slug"
        required
        requiredLabel={tCommon('required')}
        hint={t('form.slugHint')}
        error={slugError}
      >
        <Input
          id="field-slug"
          name="slug"
          required
          defaultValue={echoed?.slug}
          invalid={!!slugError}
          aria-describedby={slugError ? 'field-slug-err' : undefined}
          autoComplete="off"
          spellCheck={false}
          pattern="^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9]))*$"
          minLength={3}
          maxLength={80}
        />
      </Field>

      <Field
        label={t('form.nameLabel')}
        htmlFor="field-name"
        required
        requiredLabel={tCommon('required')}
        hint={t.rich('form.nameHint', { code: (chunks) => <code>{chunks}</code> })}
        error={nameError}
      >
        <Input
          id="field-name"
          name="name"
          required
          defaultValue={echoed?.name}
          invalid={!!nameError}
          aria-describedby={nameError ? 'field-name-err' : undefined}
          maxLength={200}
        />
      </Field>

      <Field
        label={t('form.descriptionLabel')}
        htmlFor="field-description"
        hint={t('form.descriptionHint')}
        error={descError}
      >
        <Textarea
          id="field-description"
          name="description"
          rows={4}
          maxLength={2000}
          defaultValue={echoed?.description}
          invalid={!!descError}
          aria-describedby={descError ? 'field-description-err' : undefined}
        />
      </Field>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('form.visibilityLegend')}</legend>
        <p className="text-xs text-[var(--color-muted-foreground)]">{t('form.visibilityHelp')}</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {VISIBILITY_OPTIONS.map((visibility) => (
            <label
              key={visibility}
              className="flex flex-col gap-0.5 rounded-md border border-[var(--color-border)] p-3 text-sm cursor-pointer transition-colors has-[:checked]:border-[var(--color-primary)] has-[:checked]:bg-[var(--color-primary-soft)]/40 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-ring)]"
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="visibility"
                  value={visibility}
                  defaultChecked={visibility === visibilityDefault}
                  className="accent-[var(--color-primary)]"
                />
                <span className="font-medium">{t(`form.visibility.${visibility}.title`)}</span>
              </span>
              <span className="text-xs text-[var(--color-muted-foreground)] ps-6">
                {t(`form.visibility.${visibility}.hint`)}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? t('form.creating') : t('form.submit')}
        </Button>
      </div>
    </form>
  );
}

function fieldError(state: CreateDatasetState, name: string): string | undefined {
  return state.status === 'error' ? state.fieldErrors?.get(name) : undefined;
}
