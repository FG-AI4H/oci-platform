'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription, AlertTitle, Badge, Button, Card, CardContent } from '@oci/ui';
import type { ModelCardStatus } from '@oci/shared-types';
import { changeModelCardStatusAction, type ModelCardLifecycleState } from './lifecycle-actions';

const STATUS_TONE = new Map<ModelCardStatus, 'neutral' | 'info' | 'success' | 'warning'>([
  ['DRAFT', 'neutral'],
  ['SUBMITTED', 'info'],
  ['PUBLISHED', 'success'],
  ['WITHDRAWN', 'warning'],
]);

const initial: ModelCardLifecycleState = { status: 'idle' };

/**
 * The card's status and what the signed-in caller may do with it (#651):
 * edit (DRAFT, submitter), submit, publish, return to draft, withdraw. The
 * page computes `moves` and `canEdit` with the shared rules the API applies
 * (`modelCardMovesFor`, `canEditModelCard`); a refusal from the API is shown
 * here as it comes.
 */
export function ModelCardLifecyclePanel({
  slug,
  status,
  moves,
  canEdit,
}: {
  slug: string;
  status: ModelCardStatus;
  moves: ReadonlyArray<ModelCardStatus>;
  canEdit: boolean;
}) {
  const t = useTranslations('ModelCardForm');
  const [state, action, pending] = useActionState(changeModelCardStatusAction, initial);

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold">{t('lifecycle.heading')}</h2>
          <Badge tone={STATUS_TONE.get(status) ?? 'neutral'}>
            {t(`lifecycle.status.${status}`)}
          </Badge>
        </div>
        <p className="max-w-3xl text-sm text-[var(--color-muted-foreground)]">
          {t(`lifecycle.help.${status}`)}
        </p>
        {state.status === 'error' ? (
          <Alert tone="danger">
            <AlertTitle as="h3">{t('lifecycle.errorTitle')}</AlertTitle>
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        ) : null}
        {canEdit || moves.length > 0 ? (
          <form
            action={action}
            className="flex flex-wrap items-center gap-2"
            aria-busy={pending || undefined}
          >
            <input type="hidden" name="slug" value={slug} />
            {canEdit ? (
              <Button asChild variant="secondary">
                <Link href={`/models/${encodeURIComponent(slug)}/edit`}>{t('lifecycle.edit')}</Link>
              </Button>
            ) : null}
            {moves.map((to) => (
              <Button
                key={to}
                type="submit"
                name="status"
                value={to}
                disabled={pending}
                variant={to === 'WITHDRAWN' ? 'danger' : to === 'DRAFT' ? 'secondary' : 'primary'}
              >
                {pending ? t('lifecycle.moving') : t(`lifecycle.move.${to}`)}
              </Button>
            ))}
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
