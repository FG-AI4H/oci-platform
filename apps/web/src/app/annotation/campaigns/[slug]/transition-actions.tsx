'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription, AlertTitle, Button, Field, Textarea } from '@oci/ui';
import {
  campaignActionRequiresReason,
  type CampaignStatus,
  type CampaignTransitionAction,
} from '@oci/shared-types';
import { transitionCampaignAction, type TransitionState } from './actions';

const initial: TransitionState = { status: 'idle' };

/** How each action looks; its words come from `Campaign.transitions.action`. */
const VARIANT: Record<CampaignTransitionAction, 'primary' | 'outline' | 'danger'> = {
  'mark-ready': 'primary',
  'revert-to-draft': 'outline',
  start: 'primary',
  complete: 'primary',
  archive: 'danger',
};

export interface TransitionActionsProps {
  slug: string;
  current: CampaignStatus;
  actions: ReadonlyArray<CampaignTransitionAction>;
}

export function TransitionActions({ slug, current, actions }: TransitionActionsProps) {
  const t = useTranslations('Campaign.transitions');
  const common = useTranslations('Common');
  const [state, action, pending] = useActionState(transitionCampaignAction, initial);
  const [openAction, setOpenAction] = useState<CampaignTransitionAction | null>(null);
  const label = (a: CampaignTransitionAction) => t(`action.${a}.label`);
  const prompt = (a: CampaignTransitionAction) =>
    a === 'revert-to-draft' || a === 'archive' ? t(`action.${a}.prompt`) : t('reasonHint');

  if (actions.length === 0) {
    return (
      <p className="text-sm text-[var(--color-muted-foreground)]">
        {t.rich('none', {
          status: current,
          code: (chunks) => <code className="text-xs">{chunks}</code>,
        })}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {state.status === 'success' ? (
        <Alert tone="success">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      {state.status === 'error' ? (
        <Alert tone="danger">
          <AlertTitle>{t('couldNotTransition')}</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {actions.map((a) => {
          return (
            <Button
              key={a}
              type="button"
              // eslint-disable-next-line security/detect-object-injection -- typed enum keys
              variant={VARIANT[a]}
              size="sm"
              onClick={() => setOpenAction(a === openAction ? null : a)}
              aria-expanded={openAction === a}
            >
              {label(a)}
            </Button>
          );
        })}
      </div>

      {openAction ? (
        <form
          action={action}
          className="space-y-3 rounded-md border border-[var(--color-border)] bg-[var(--color-subtle)]/40 p-4"
        >
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="action" value={openAction} />
          <p className="text-sm text-[var(--color-foreground)]">
            {t(`action.${openAction}.confirm`)}
          </p>
          {requiresReason(openAction, current) ? (
            <Field label={t('reason')} htmlFor="field-reason" required hint={prompt(openAction)}>
              <Textarea id="field-reason" name="reason" rows={3} maxLength={500} required />
            </Field>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpenAction(null)}>
              {common('cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? t('applying') : t('confirmAction', { label: label(openAction) })}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function requiresReason(action: CampaignTransitionAction, current: CampaignStatus): boolean {
  return campaignActionRequiresReason(current, action);
}
