'use client';

import { useActionState, useId, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, AlertDescription, AlertTitle, Button, Field, Textarea } from '@oci/ui';
import type { AssignmentSummary } from '@oci/shared-types';
import {
  pullNextAction,
  submitAssignmentAction,
  type PullState,
  type SubmitState,
} from './actions';

const initialPull: PullState = { status: 'idle' };
const initialSubmit: SubmitState = { status: 'idle' };

interface AnnotateFormProps {
  slug: string;
  assignment: AssignmentSummary;
  /** The campaign's current instructions version; null when none is published. */
  instructionsVersion: string | null;
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
export function AnnotateForm({ slug, assignment, instructionsVersion }: AnnotateFormProps) {
  const [submitState, submitAction, submitPending] = useActionState(
    submitAssignmentAction,
    initialSubmit,
  );
  const [pullState, pullAction, pullPending] = useActionState(pullNextAction, initialPull);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // The version the annotator confirmed. It stays confirmed across
  // tasks, and un-confirms itself when a new version is published.
  const [acknowledged, setAcknowledged] = useState<string | null>(null);
  const ackId = useId();

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
        {instructionsVersion ? (
          // The API refuses a submission that doesn't name the current
          // instructions version (#230).
          <div className="rounded-md border border-[var(--color-border)] p-3 text-sm">
            <label htmlFor={ackId} className="flex items-start gap-2">
              <input
                id={ackId}
                type="checkbox"
                name="acknowledgedInstructionsVersion"
                value={instructionsVersion}
                checked={acknowledged === instructionsVersion}
                onChange={(e) => setAcknowledged(e.target.checked ? instructionsVersion : null)}
                required
                className="mt-0.5 accent-[var(--color-primary)]"
              />
              <span>
                I have read the current instructions, version{' '}
                <span className="font-mono">{instructionsVersion}</span>.
              </span>
            </label>
            <Link
              href={`/annotation/campaigns/${slug}/instructions`}
              target="_blank"
              rel="noopener noreferrer"
              className="ms-6 mt-1 inline-block text-[var(--color-primary)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded"
            >
              Read version {instructionsVersion} (opens in new tab)
            </Link>
          </div>
        ) : null}
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
