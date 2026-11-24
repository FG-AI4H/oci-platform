'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription, Button } from '@oci/ui';
import { releaseAssignmentAction, type ReleaseState } from './actions';

const initialRelease: ReleaseState = { status: 'idle' };

/**
 * Skip on its own, for a task whose image could not be fetched (#646
 * review, item 5): with nothing on screen there is nothing to answer,
 * so the reader can only give the task back.
 */
export function SkipTaskForm({ slug, assignmentId }: { slug: string; assignmentId: string }) {
  const t = useTranslations('Annotate.form');
  const [state, action, pending] = useActionState(releaseAssignmentAction, initialRelease);
  return (
    <div className="space-y-3">
      {state.status === 'error' ? (
        <Alert tone="danger">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      <form action={action}>
        <input type="hidden" name="assignmentId" value={assignmentId} />
        <input type="hidden" name="slug" value={slug} />
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? t('skipping') : t('skip')}
        </Button>
      </form>
    </div>
  );
}
