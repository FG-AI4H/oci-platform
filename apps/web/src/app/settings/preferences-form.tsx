'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@oci/ui';
import type { UserPreferences } from '@oci/shared-types';
import { localeName, LOCALES } from '../../i18n/locales';
import { updatePreferencesAction, type PreferencesFormState } from './actions';

const INITIAL_STATE: PreferencesFormState = { status: 'idle' };

export function PreferencesForm({
  initial,
  savedFlag,
}: {
  initial: UserPreferences;
  savedFlag: boolean;
}) {
  const [state, formAction, pending] = useActionState(updatePreferencesAction, INITIAL_STATE);
  const t = useTranslations('Settings');

  // Echo back the user's last attempt on validation failure so they
  // don't lose their input.
  const values =
    state.status === 'error' && state.values
      ? state.values
      : {
          darkMode: initial.darkMode,
          density: initial.density,
          locale: initial.locale ?? '',
        };
  const fieldErrors = state.status === 'error' ? state.fieldErrors : undefined;
  // A tag saved before the interface had languages (`de-CH`, `fr-CH`)
  // stays selectable as it is, so saving the form does not change it.
  const storedOther =
    values.locale !== '' && !(LOCALES as readonly string[]).includes(values.locale)
      ? values.locale
      : null;

  return (
    <form action={formAction} className="space-y-8">
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-[var(--color-foreground)]">
          {t('theme.legend')}
        </legend>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          {t.rich('theme.help', { strong: (chunks) => <strong>{chunks}</strong> })}
        </p>
        <div role="radiogroup" aria-label={t('theme.groupLabel')} className="flex flex-wrap gap-3">
          <ThemeRadio
            name="darkMode"
            value="system"
            label={t('theme.system')}
            description={t('theme.systemDescription')}
            checked={values.darkMode === 'system'}
          />
          <ThemeRadio
            name="darkMode"
            value="light"
            label={t('theme.light')}
            description={t('theme.lightDescription')}
            checked={values.darkMode === 'light'}
          />
          <ThemeRadio
            name="darkMode"
            value="dark"
            label={t('theme.dark')}
            description={t('theme.darkDescription')}
            checked={values.darkMode === 'dark'}
          />
        </div>
        {fieldErrors?.get('darkMode') ? (
          <p className="text-sm text-[var(--color-danger)]">{fieldErrors.get('darkMode')}</p>
        ) : null}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-[var(--color-foreground)]">
          {t('density.legend')}
        </legend>
        <p className="text-sm text-[var(--color-muted-foreground)]">{t('density.help')}</p>
        <div role="radiogroup" aria-label={t('density.legend')} className="flex flex-wrap gap-3">
          <ThemeRadio
            name="density"
            value="comfortable"
            label={t('density.comfortable')}
            description={t('density.comfortableDescription')}
            checked={values.density === 'comfortable'}
          />
          <ThemeRadio
            name="density"
            value="compact"
            label={t('density.compact')}
            description={t('density.compactDescription')}
            checked={values.density === 'compact'}
          />
        </div>
        {fieldErrors?.get('density') ? (
          <p className="text-sm text-[var(--color-danger)]">{fieldErrors.get('density')}</p>
        ) : null}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-[var(--color-foreground)]">
          {t('language.legend')}
        </legend>
        <p id="locale-help" className="text-sm text-[var(--color-muted-foreground)]">
          {t('language.help')}
        </p>
        <label htmlFor="locale" className="sr-only">
          {t('language.legend')}
        </label>
        {/* Keyed on the value so a saved change re-renders the select
            with it as the default. */}
        <select
          key={values.locale}
          id="locale"
          name="locale"
          defaultValue={values.locale}
          className="w-full max-w-xs rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 py-2 text-sm text-[var(--color-foreground)] focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
          aria-invalid={fieldErrors?.has('locale') ? true : undefined}
          aria-describedby={fieldErrors?.get('locale') ? 'locale-error' : 'locale-help'}
        >
          <option value="">{t('language.browser')}</option>
          {LOCALES.map((locale) => (
            <option key={locale} value={locale} lang={locale}>
              {localeName(locale)}
            </option>
          ))}
          {storedOther ? (
            <option value={storedOther}>{t('language.other', { tag: storedOther })}</option>
          ) : null}
        </select>
        {fieldErrors?.get('locale') ? (
          <p id="locale-error" className="text-sm text-[var(--color-danger)]">
            {fieldErrors.get('locale')}
          </p>
        ) : null}
      </fieldset>

      {state.status === 'error' && state.message ? (
        <p
          role="alert"
          className="rounded-md border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]"
        >
          {state.message}
        </p>
      ) : null}
      {savedFlag && state.status === 'idle' ? (
        <p
          role="status"
          className="rounded-md border border-[var(--color-success)] bg-[var(--color-success-soft)] px-3 py-2 text-sm text-[var(--color-success)]"
        >
          {t('saved')}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-3 border-t border-[var(--color-border)] pt-4">
        <Button type="submit" disabled={pending}>
          {pending ? t('saving') : t('save')}
        </Button>
      </div>
    </form>
  );
}

function ThemeRadio({
  name,
  value,
  label,
  description,
  checked,
}: {
  name: string;
  value: string;
  label: string;
  description: string;
  checked: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3 text-sm has-[:checked]:border-[var(--color-primary)] has-[:checked]:ring-1 has-[:checked]:ring-[var(--color-primary)]">
      <input
        type="radio"
        name={name}
        value={value}
        aria-label={label}
        defaultChecked={checked}
        className="mt-1 accent-[var(--color-primary)]"
      />
      <span className="flex flex-col">
        <span className="font-medium text-[var(--color-foreground)]">{label}</span>
        <span className="text-xs text-[var(--color-muted-foreground)]">{description}</span>
      </span>
    </label>
  );
}
