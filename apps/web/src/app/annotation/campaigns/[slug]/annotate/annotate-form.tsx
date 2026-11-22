'use client';

import { useActionState, useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle, Button, Field, Textarea } from '@oci/ui';
import type { AssignmentSummary, ClassificationLabelsConfig } from '@oci/shared-types';
import {
  releaseAssignmentAction,
  submitAssignmentAction,
  type ReleaseState,
  type SubmitState,
} from './actions';
import { LabelChoices } from './label-choices';

const initialSubmit: SubmitState = { status: 'idle' };
const initialRelease: ReleaseState = { status: 'idle' };

interface AnnotateFormProps {
  slug: string;
  assignment: AssignmentSummary;
  /** The campaign's current instructions version; null when none is published. */
  instructionsVersion: string | null;
  /** The campaign's declared labels (#646); null keeps the free-form JSON form. */
  labels: ClassificationLabelsConfig | null;
  /** Arbitration on a labelled campaign: the arbiter must say why (#646). */
  reasonRequired?: boolean;
}

/**
 * Annotator submission form (#215 slice 2 web slice).
 *
 * The page already loaded the in-flight assignment server-side. This
 * client component owns the submit form and "Skip" (#646). Both
 * actions redirect back to the queue on success, which offers the
 * next task.
 *
 * A campaign with declared labels (#646) shows them as radio buttons
 * with number-key shortcuts and submits `{ label, comment }`. Other
 * campaigns keep the free-form JSON textarea — tool-integration-aware
 * schema validation per ADR-0007 lands with #214.
 */
export function AnnotateForm({
  slug,
  assignment,
  instructionsVersion,
  labels,
  reasonRequired = false,
}: AnnotateFormProps) {
  const [submitState, submitAction, submitPending] = useActionState(
    submitAssignmentAction,
    initialSubmit,
  );
  const [releaseState, releaseAction, releasePending] = useActionState(
    releaseAssignmentAction,
    initialRelease,
  );
  const busy = submitPending || releasePending;
  // The version the annotator confirmed. It stays confirmed across
  // tasks (each task remounts this form, so it is kept for the browser
  // session), and un-confirms itself when a new version is published.
  const [acknowledged, setAcknowledgedState] = useState<string | null>(null);
  const ackKey = `oci:annotate:${slug}:acknowledged`;
  useEffect(() => {
    try {
      setAcknowledgedState(window.sessionStorage.getItem(ackKey));
    } catch {
      // Storage blocked: the reader confirms on each task instead.
    }
  }, [ackKey]);
  function setAcknowledged(version: string | null) {
    setAcknowledgedState(version);
    try {
      if (version) window.sessionStorage.setItem(ackKey, version);
      else window.sessionStorage.removeItem(ackKey);
    } catch {
      // Storage blocked: nothing to remember.
    }
  }
  const ackId = useId();
  const skipFormId = useId();

  return (
    <div className="space-y-5">
      {submitState.status === 'error' ? (
        <Alert tone="danger">
          <AlertTitle>Could not submit</AlertTitle>
          <AlertDescription>{submitState.message}</AlertDescription>
        </Alert>
      ) : null}
      {releaseState.status === 'error' ? (
        <Alert tone="danger">
          <AlertTitle>Could not skip</AlertTitle>
          <AlertDescription>{releaseState.message}</AlertDescription>
        </Alert>
      ) : null}

      <form action={submitAction} className="space-y-3">
        <input type="hidden" name="assignmentId" value={assignment.id} />
        <input type="hidden" name="slug" value={slug} />
        {labels ? (
          <LabelChoices
            labels={labels}
            reasonRequired={reasonRequired}
            echoed={submitState.status === 'error' ? submitState.submission : null}
          />
        ) : (
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
        )}
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
          <Button type="submit" variant="primary" disabled={busy}>
            {submitPending ? 'Submitting…' : labels ? 'Submit (Enter)' : 'Submit'}
          </Button>
          {/* Skip lives in its own form; `form=` ties the button to it
              so it sits beside Submit without nesting forms. */}
          <Button type="submit" variant="outline" form={skipFormId} disabled={busy}>
            {releasePending ? 'Skipping…' : 'Skip'}
          </Button>
        </div>
      </form>
      <form id={skipFormId} action={releaseAction} hidden>
        <input type="hidden" name="assignmentId" value={assignment.id} />
        <input type="hidden" name="slug" value={slug} />
      </form>
      <p className="text-sm text-[var(--color-muted-foreground)]">
        Skip gives this task back unread, so another annotator can take it.
      </p>
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
