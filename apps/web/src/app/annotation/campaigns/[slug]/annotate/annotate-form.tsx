'use client';

import { useActionState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, AlertDescription, AlertTitle, Button, Field, Textarea } from '@oci/ui';
import type { AssignmentSummary } from '@oci/shared-types';
import { initialPull, initialSubmit, pullNextAction, submitAssignmentAction } from './actions';

interface AnnotateFormProps {
  slug: string;
  assignment: AssignmentSummary;
}

/**
 * Annotator submission form (#215 slice 2 web slice).
 *
 * The page already loaded the in-flight assignment server-side. This
 * client component owns the submit form + the "pass / pull-next"
 * button so the annotator can chain tasks without a full page nav
 * (the server action revalidates the route on success, so the next
 * paint shows the next task).
 *
 * Submission shape is free-form JSON today — tool-integration-aware
 * schema validation per ADR-0007 lands with #214. The textarea
 * placeholder shows a minimal valid example so first-time annotators
 * aren't staring at a blank box.
 */
export function AnnotateForm({ slug, assignment }: AnnotateFormProps) {
  const [submitState, submitAction, submitPending] = useActionState(
    submitAssignmentAction,
    initialSubmit,
  );
  const [pullState, pullAction, pullPending] = useActionState(pullNextAction, initialPull);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // On a successful submit that completed the task, refresh the page
  // so the server picks up the next assignment via the idempotent
  // pull-next probe in page.tsx.
  if (submitState.status === 'success' && submitState.newGateState !== null) {
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-5">
      {submitState.status === 'success' ? (
        <Alert tone="success">
          <AlertTitle>Submission recorded</AlertTitle>
          <AlertDescription>{submitState.message}</AlertDescription>
        </Alert>
      ) : null}
      {submitState.status === 'error' ? (
        <Alert tone="danger">
          <AlertTitle>Could not submit</AlertTitle>
          <AlertDescription>{submitState.message}</AlertDescription>
        </Alert>
      ) : null}

      <form action={submitAction} className="space-y-3">
        <input type="hidden" name="assignmentId" value={assignment.id} />
        <input type="hidden" name="slug" value={slug} />
        <Field
          label="Annotation"
          htmlFor="field-submission"
          hint='Free-form JSON today (e.g. {"label": "pneumonia"} for classification, or a mask URL for segmentation). The tool-integration-aware schema lands with #214.'
        >
          <Textarea
            id="field-submission"
            name="submission"
            rows={8}
            maxLength={20_000}
            defaultValue={
              submitState.status === 'error'
                ? submitState.submission
                : defaultPayloadFor(assignment.gateAtAssignment)
            }
            spellCheck={false}
            className="font-mono"
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={submitPending || isPending}>
            {submitPending ? 'Submitting…' : 'Submit'}
          </Button>
        </div>
      </form>

      <div className="border-t border-[var(--color-border)] pt-4">
        {pullState.status === 'success' && pullState.assignmentId === null ? (
          <Alert tone="info">
            <AlertDescription>{pullState.message}</AlertDescription>
          </Alert>
        ) : null}
        {pullState.status === 'error' ? (
          <Alert tone="danger">
            <AlertTitle>Could not pull next</AlertTitle>
            <AlertDescription>{pullState.message}</AlertDescription>
          </Alert>
        ) : null}
        <form action={pullAction}>
          <input type="hidden" name="slug" value={slug} />
          <Button type="submit" variant="outline" disabled={pullPending}>
            {pullPending ? 'Refreshing…' : 'Re-check the queue'}
          </Button>
        </form>
      </div>
    </div>
  );
}

function defaultPayloadFor(gate: AssignmentSummary['gateAtAssignment']): string {
  if (gate === 'AWAITING_EXPERT') {
    return JSON.stringify({ decision: 'accept', rationale: '' }, null, 2);
  }
  if (gate === 'AWAITING_ARBITRATION') {
    return JSON.stringify({ resolution: '', rationale: '' }, null, 2);
  }
  return JSON.stringify({ label: '' }, null, 2);
}
