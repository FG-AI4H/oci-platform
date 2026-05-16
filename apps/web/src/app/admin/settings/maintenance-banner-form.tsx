'use client';

import { useActionState, useState } from 'react';
import { Alert, AlertDescription, AlertTitle, Button, Field, Input, Textarea } from '@oci/ui';
import type { MaintenanceBanner, MaintenanceBannerTone } from '@oci/shared-types';
import { updateSettingsAction, type UpdateSettingsState } from './actions';

const initial: UpdateSettingsState = { status: 'idle' };

const TONE_OPTIONS: ReadonlyArray<{ value: MaintenanceBannerTone; label: string }> = [
  { value: 'info', label: 'Info — normal-priority notice' },
  { value: 'warning', label: 'Warning — degraded service / scheduled maintenance' },
  { value: 'danger', label: 'Danger — incident / outage' },
];

export interface MaintenanceBannerFormProps {
  /** Current persisted banner, or null when none is configured. */
  initialBanner: MaintenanceBanner | null;
}

export function MaintenanceBannerForm({ initialBanner }: MaintenanceBannerFormProps) {
  const [state, action, pending] = useActionState(updateSettingsAction, initial);

  // The toggle is client-state so the form fields can disable when it
  // flips off. On error we fall back to the echoed value the server
  // sent back.
  const [enabled, setEnabled] = useState<boolean>(
    state.status === 'error' ? state.values?.bannerEnabled === 'on' : initialBanner !== null,
  );

  const echoed = state.status === 'error' ? state.values : undefined;
  const messageDefault = echoed?.bannerMessage ?? initialBanner?.message ?? '';
  const toneDefault: MaintenanceBannerTone =
    (echoed?.bannerTone as MaintenanceBannerTone | undefined) ?? initialBanner?.tone ?? 'info';
  const fromDefault = echoed?.bannerVisibleFrom ?? toLocalDatetime(initialBanner?.visibleFrom);
  const untilDefault = echoed?.bannerVisibleUntil ?? toLocalDatetime(initialBanner?.visibleUntil);

  const fieldError = (name: string): string | undefined =>
    state.status === 'error' ? state.fieldErrors?.get(name) : undefined;

  return (
    <form action={action} className="space-y-5" aria-busy={pending || undefined}>
      {state.status === 'error' ? (
        <Alert tone="danger">
          <AlertTitle>Could not save settings</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      {state.status === 'success' ? (
        <Alert tone="success">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          name="bannerEnabled"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4 accent-[var(--color-primary)] cursor-pointer"
        />
        <span className="font-medium">Show site-wide maintenance banner</span>
      </label>

      <fieldset disabled={!enabled} className="space-y-5 opacity-100 disabled:opacity-60">
        <Field
          label="Message"
          htmlFor="field-msg"
          required
          hint="Plain text shown above the site header. <= 280 characters."
          error={fieldError('bannerMessage')}
        >
          <Textarea
            id="field-msg"
            name="bannerMessage"
            rows={3}
            maxLength={280}
            defaultValue={messageDefault}
            invalid={!!fieldError('bannerMessage')}
            placeholder="e.g. Scheduled maintenance 02:00–03:00 UTC; uploads may briefly fail."
          />
        </Field>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Tone</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {TONE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className="flex items-center gap-2 rounded-md border border-[var(--color-border)] p-3 text-sm cursor-pointer transition-colors has-[:checked]:border-[var(--color-primary)] has-[:checked]:bg-[var(--color-primary-soft)]/40 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-ring)]"
              >
                <input
                  type="radio"
                  name="bannerTone"
                  value={opt.value}
                  defaultChecked={opt.value === toneDefault}
                  className="accent-[var(--color-primary)]"
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Visible from"
            htmlFor="field-from"
            required
            hint="UTC. The banner only shows after this time."
            error={fieldError('bannerVisibleFrom')}
          >
            <Input
              id="field-from"
              name="bannerVisibleFrom"
              type="datetime-local"
              defaultValue={fromDefault}
              invalid={!!fieldError('bannerVisibleFrom')}
            />
          </Field>
          <Field
            label="Visible until"
            htmlFor="field-until"
            required
            hint="UTC. The banner disappears at this time."
            error={fieldError('bannerVisibleUntil')}
          >
            <Input
              id="field-until"
              name="bannerVisibleUntil"
              type="datetime-local"
              defaultValue={untilDefault}
              invalid={!!fieldError('bannerVisibleUntil')}
            />
          </Field>
        </div>
      </fieldset>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save settings'}
        </Button>
      </div>
    </form>
  );
}

/**
 * Convert an ISO timestamp back to the `<input type="datetime-local">`
 * shape (`YYYY-MM-DDTHH:MM`). The form interprets values as UTC; this
 * round-trips that interpretation losslessly.
 */
function toLocalDatetime(iso: string | undefined): string {
  if (!iso) return '';
  // ISO `2026-05-16T14:00:00.000Z` -> `2026-05-16T14:00`
  return iso.slice(0, 16);
}
