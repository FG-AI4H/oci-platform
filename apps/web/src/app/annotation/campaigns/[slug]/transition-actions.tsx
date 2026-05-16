'use client';

import { useActionState, useState } from 'react';
import { Alert, AlertDescription, AlertTitle, Button, Field, Textarea } from '@oci/ui';
import {
  campaignActionRequiresReason,
  type CampaignStatus,
  type CampaignTransitionAction,
} from '@oci/shared-types';
import { transitionCampaignAction, type TransitionState } from './actions';

const initial: TransitionState = { status: 'idle' };

interface ActionMeta {
  label: string;
  variant: 'primary' | 'outline' | 'danger';
  /** Visible label for the reason field when shown. */
  reasonPrompt?: string;
  confirmationCopy: string;
}

const META: Record<CampaignTransitionAction, ActionMeta> = {
  'mark-ready': {
    label: 'Mark ready',
    variant: 'primary',
    confirmationCopy: 'Mark this draft as ready to run.',
  },
  'revert-to-draft': {
    label: 'Revert to draft',
    variant: 'outline',
    reasonPrompt: 'Why is the campaign going back to draft?',
    confirmationCopy: 'Send the campaign back to draft so the manager can edit it.',
  },
  start: {
    label: 'Start campaign',
    variant: 'primary',
    confirmationCopy:
      'Move the campaign to RUNNING. Tasks become available to annotators when slice 2 ships.',
  },
  complete: {
    label: 'Complete',
    variant: 'primary',
    confirmationCopy: 'Mark the campaign as completed.',
  },
  archive: {
    label: 'Archive',
    variant: 'danger',
    reasonPrompt: 'Reason for archiving (required for emergency stop).',
    confirmationCopy: 'Archive this campaign.',
  },
};

export interface TransitionActionsProps {
  slug: string;
  current: CampaignStatus;
  actions: ReadonlyArray<CampaignTransitionAction>;
}

export function TransitionActions({ slug, current, actions }: TransitionActionsProps) {
  const [state, action, pending] = useActionState(transitionCampaignAction, initial);
  const [openAction, setOpenAction] = useState<CampaignTransitionAction | null>(null);

  if (actions.length === 0) {
    return (
      <p className="text-sm text-[var(--color-muted-foreground)]">
        No transitions available from <code className="text-xs">{current}</code>.
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
          <AlertTitle>Could not transition</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {actions.map((a) => {
          // eslint-disable-next-line security/detect-object-injection -- typed enum keys
          const meta = META[a];
          return (
            <Button
              key={a}
              type="button"
              variant={meta.variant}
              size="sm"
              onClick={() => setOpenAction(a === openAction ? null : a)}
              aria-expanded={openAction === a}
            >
              {meta.label}
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
            {/* eslint-disable-next-line security/detect-object-injection -- typed enum keys */}
            {META[openAction].confirmationCopy}
          </p>
          {requiresReason(openAction, current) ? (
            <Field
              label="Reason"
              htmlFor="field-reason"
              required
              // eslint-disable-next-line security/detect-object-injection -- typed enum keys
              hint={META[openAction].reasonPrompt ?? 'Recorded in the audit log.'}
            >
              <Textarea id="field-reason" name="reason" rows={3} maxLength={500} required />
            </Field>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpenAction(null)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {/* eslint-disable-next-line security/detect-object-injection -- typed enum keys */}
              {pending ? 'Applying…' : `Confirm: ${META[openAction].label}`}
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
