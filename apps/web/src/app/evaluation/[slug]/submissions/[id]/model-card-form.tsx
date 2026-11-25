'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription, AlertTitle, Button } from '@oci/ui';
import type { ModelCardOption } from '../../../../../components/evaluation/model-card-choice';
import { ModelCardPicker } from '../../../../../components/evaluation/model-card-picker';
import { linkModelCardAction, type LinkModelCardState } from './model-card-actions';

const initial: LinkModelCardState = { status: 'idle' };

/**
 * Link this submission to a model card, change the card, or remove the link
 * (#587). Shown to the submission's submitter only. One picker, the submit
 * page's, and one button: "No model card" removes the link.
 *
 * With no card to offer and none linked, the picker's "Declare a model" line
 * stands alone and there is nothing to save.
 *
 * Text: `EvaluationSubmit.modelCard`.
 */
export function LinkModelCardForm({
  slug,
  submissionId,
  options,
  currentModelCardId,
}: {
  slug: string;
  submissionId: string;
  /** `null` when the caller's cards could not be read. */
  options: readonly ModelCardOption[] | null;
  /** The card linked now, or `''`. */
  currentModelCardId: string;
}) {
  const t = useTranslations('EvaluationSubmit');
  const [state, formAction, pending] = useActionState(
    linkModelCardAction.bind(null, slug, submissionId),
    initial,
  );
  const canSave = options !== null && (options.length > 0 || currentModelCardId !== '');
  const chosen = state.status === 'error' ? state.modelCardId : currentModelCardId;

  return (
    <form action={formAction} className="space-y-4" aria-busy={pending || undefined}>
      <input type="hidden" name="currentModelCardId" value={currentModelCardId} />
      {canSave ? (
        <div className="flex max-w-2xl flex-col gap-3 sm:flex-row sm:items-start">
          <ModelCardPicker
            id="field-link-model-card"
            // Under the card's "Model card" heading, the select says what it changes.
            label={t('modelCard.link.label')}
            options={options}
            defaultValue={chosen}
            hint={t('modelCard.link.hint')}
            invalid={state.status === 'error'}
            className="min-w-0 sm:flex-1"
          />
          {/* Lined up with the select, below the label, from the small breakpoint up. */}
          <Button type="submit" variant="secondary" disabled={pending} className="sm:mt-6.5">
            {pending ? t('modelCard.link.saving') : t('modelCard.link.save')}
          </Button>
        </div>
      ) : (
        <ModelCardPicker
          id="field-link-model-card"
          options={options}
          defaultValue=""
          hint={t('modelCard.link.hint')}
        />
      )}
      {state.status === 'error' ? (
        <Alert tone="danger">
          <AlertTitle as="h3">{t('modelCard.link.errorTitle')}</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
    </form>
  );
}
