'use client';

import { useActionState } from 'react';
import { Button } from '@oci/ui';
import type { UserPreferences } from '@oci/shared-types';
import {
  updatePreferencesAction,
  type PreferencesFormState,
} from './actions';

const INITIAL_STATE: PreferencesFormState = { status: 'idle' };

export function PreferencesForm({
  initial,
  savedFlag,
}: {
  initial: UserPreferences;
  savedFlag: boolean;
}) {
  const [state, formAction, pending] = useActionState(updatePreferencesAction, INITIAL_STATE);

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

  return (
    <form action={formAction} className="space-y-8">
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-[var(--color-foreground)]">Theme</legend>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Choose how the platform should look. <strong>System</strong> follows your device
          setting; <strong>Light</strong> and <strong>Dark</strong> override it.
        </p>
        <div role="radiogroup" aria-label="Dark mode" className="flex flex-wrap gap-3">
          <ThemeRadio
            name="darkMode"
            value="system"
            label="System"
            description="Follow OS preference"
            checked={values.darkMode === 'system'}
          />
          <ThemeRadio
            name="darkMode"
            value="light"
            label="Light"
            description="Always light"
            checked={values.darkMode === 'light'}
          />
          <ThemeRadio
            name="darkMode"
            value="dark"
            label="Dark"
            description="Always dark"
            checked={values.darkMode === 'dark'}
          />
        </div>
        {fieldErrors?.get('darkMode') ? (
          <p className="text-sm text-[var(--color-danger)]">{fieldErrors.get('darkMode')}</p>
        ) : null}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-[var(--color-foreground)]">Density</legend>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Comfortable spacing or compact for table-heavy workflows.
        </p>
        <div role="radiogroup" aria-label="Density" className="flex flex-wrap gap-3">
          <ThemeRadio
            name="density"
            value="comfortable"
            label="Comfortable"
            description="Default spacing"
            checked={values.density === 'comfortable'}
          />
          <ThemeRadio
            name="density"
            value="compact"
            label="Compact"
            description="Tighter rows, more on screen"
            checked={values.density === 'compact'}
          />
        </div>
        {fieldErrors?.get('density') ? (
          <p className="text-sm text-[var(--color-danger)]">{fieldErrors.get('density')}</p>
        ) : null}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-[var(--color-foreground)]">Language</legend>
        <p id="locale-help" className="text-sm text-[var(--color-muted-foreground)]">
          BCP-47 tag (e.g. <code>en</code>, <code>fr-CH</code>, <code>de-CH</code>). Leave blank to
          follow your browser.
        </p>
        <label htmlFor="locale" className="sr-only">
          Language
        </label>
        <input
          id="locale"
          type="text"
          name="locale"
          defaultValue={values.locale}
          placeholder="e.g. en-US"
          autoComplete="off"
          className="w-full max-w-xs rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 py-2 text-sm text-[var(--color-foreground)] focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
          aria-invalid={fieldErrors?.has('locale') ? true : undefined}
          aria-describedby={fieldErrors?.get('locale') ? 'locale-error' : 'locale-help'}
        />
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
          Preferences saved.
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save preferences'}
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
