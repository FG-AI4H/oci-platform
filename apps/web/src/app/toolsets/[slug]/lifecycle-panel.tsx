'use client';

import { useActionState, type FormEvent } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Badge, Button } from '@oci/ui';
import type { ToolsetStatus } from '@oci/shared-types';
import { changeToolsetStatusAction } from '../actions';
import type { ToolsetLifecycleState } from '../toolset-action-state';

/**
 * Where a toolset stands and what this person may do about it (#830,
 * ADR-0031 decision 5). Shown to its declarer and to operators. The moves
 * are the ones the API computed for the caller; it checks them again.
 */

interface Props {
  slug: string;
  status: ToolsetStatus;
  statusLabel: string;
  moves: ReadonlyArray<'PUBLISHED' | 'WITHDRAWN'>;
  canEdit: boolean;
}

const STATUS_TONE: Record<ToolsetStatus, 'info' | 'success' | 'neutral'> = {
  DRAFT: 'info',
  PUBLISHED: 'success',
  WITHDRAWN: 'neutral',
};

const initial: ToolsetLifecycleState = { status: 'idle' };

export function ToolsetLifecyclePanel({ slug, status, statusLabel, moves, canEdit }: Props) {
  const t = useTranslations('ToolsetForm');
  const [state, action, pending] = useActionState(changeToolsetStatusAction, initial);
  // eslint-disable-next-line security/detect-object-injection -- closed key set
  const tone = STATUS_TONE[status];
  // A draft its viewer can publish is someone waiting on an operator.
  const body =
    status === 'DRAFT' && moves.includes('PUBLISHED') && !canEdit
      ? t('lifecycle.DRAFTOperator')
      : t(`lifecycle.${status}`);

  /** Withdrawing cannot be undone: ask once before the form is sent. */
  function confirmWithdraw(event: FormEvent<HTMLFormElement>) {
    if (!window.confirm(t('lifecycle.confirmWithdraw'))) event.preventDefault();
  }

  return (
    <section
      aria-labelledby="toolset-status"
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="toolset-status" className="text-sm font-semibold">
          {t('lifecycle.title')}
        </h2>
        <Badge tone={tone}>{statusLabel}</Badge>
      </div>
      <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">{body}</p>
      {state.status === 'error' ? (
        <p role="alert" className="mt-2 text-sm text-[var(--color-danger)]">
          {state.message}
        </p>
      ) : null}
      {canEdit || moves.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {canEdit ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/toolsets/${encodeURIComponent(slug)}/edit`}>{t('lifecycle.edit')}</Link>
            </Button>
          ) : null}
          {moves.includes('PUBLISHED') ? (
            <form action={action}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="status" value="PUBLISHED" />
              <Button type="submit" size="sm" disabled={pending}>
                {t('lifecycle.publish')}
              </Button>
            </form>
          ) : null}
          {moves.includes('WITHDRAWN') ? (
            <form action={action} onSubmit={confirmWithdraw}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="status" value="WITHDRAWN" />
              <Button type="submit" variant="outline" size="sm" disabled={pending}>
                {t('lifecycle.withdraw')}
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
