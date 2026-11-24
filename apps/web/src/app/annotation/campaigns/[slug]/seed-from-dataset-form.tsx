'use client';

import { useActionState, useId } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription, AlertTitle, Button, Field, Input } from '@oci/ui';
import { seedFromDatasetAction, type SeedFromDatasetState } from './tasks-actions';

const initial: SeedFromDatasetState = { status: 'idle' };

/**
 * "Create tasks from the dataset's files" (#646): one task per hosted
 * PNG / JPEG file and per DICOM series (#674) of the campaign's pinned
 * dataset version, without typing a file name. Counts first, then asks
 * the manager to confirm.
 */
export function SeedFromDatasetForm({ slug }: { slug: string }) {
  const t = useTranslations('Campaign.fromDataset');
  const [state, action, pending] = useActionState(seedFromDatasetAction, initial);
  const prefixId = useId();
  const limitId = useId();
  const echoed = state.status === 'idle' ? null : state;

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="slug" value={slug} />
      <h3 className="text-sm font-semibold">{t('title')}</h3>
      <p className="text-sm text-[var(--color-muted-foreground)]">{t('body')}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('prefix')} htmlFor={prefixId} hint={t('prefixHint')}>
          <Input id={prefixId} name="prefix" maxLength={200} defaultValue={echoed?.prefix ?? ''} />
        </Field>
        <Field label={t('limit')} htmlFor={limitId} hint={t('limitHint')}>
          <Input
            id={limitId}
            name="limit"
            type="number"
            inputMode="numeric"
            min={1}
            max={10_000}
            step={1}
            defaultValue={echoed?.limit ?? ''}
          />
        </Field>
      </div>

      {state.status === 'error' ? (
        <Alert tone="danger">
          <AlertTitle>{t('nothingCreated')}</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      {state.status === 'success' ? (
        <Alert tone="success">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      {state.status === 'preview' ? (
        <div className="space-y-3 rounded-md border border-[var(--color-border)] p-3">
          <p role="status" className="text-sm">
            {state.matched === 0
              ? t('noMatch')
              : t('preview', {
                  matched: state.matched,
                  toCreate: state.toCreate,
                  already: state.alreadyThere,
                })}
            {state.held > 0 ? ` ${t('held', { held: state.held })}` : null}
          </p>
          <div className="flex flex-wrap gap-2">
            {state.toCreate > 0 ? (
              <Button type="submit" name="intent" value="create" disabled={pending}>
                {pending ? t('creating') : t('create', { count: state.toCreate })}
              </Button>
            ) : null}
            <Button
              type="submit"
              name="intent"
              value="preview"
              variant="outline"
              disabled={pending}
            >
              {t('countAgain')}
            </Button>
          </div>
        </div>
      ) : (
        <Button type="submit" name="intent" value="preview" variant="primary" disabled={pending}>
          {pending ? t('counting') : t('count')}
        </Button>
      )}
    </form>
  );
}
