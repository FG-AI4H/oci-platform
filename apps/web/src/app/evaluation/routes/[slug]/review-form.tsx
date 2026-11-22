'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { reviewNeedsRationale, type RouteReviewStatus } from '@oci/shared-types';
import { Alert, AlertDescription, AlertTitle, Button, Field, Textarea } from '@oci/ui';
import { recordReviewAction, type ReviewState } from './review-actions';
import { decisionChoices, RATIONALE_MAX } from './review-outcome';
import { decisionText, REVIEW_TEXT } from './strings';

const initial: ReviewState = { status: 'idle' };

interface Props {
  slug: string;
  methodName: string;
  version: string;
  versionId: string;
  reviewStatus: RouteReviewStatus;
  /** The statuses the API says this caller may move the version to. */
  allowed: ReadonlyArray<RouteReviewStatus>;
  /** `withdraw` for the method's submitter, who may only withdraw. */
  mode: 'review' | 'withdraw';
  /** True when a rationale is already published, which a decision replaces. */
  replacesRationale: boolean;
}

/**
 * Review, or withdraw, one version of an evaluation method (#649).
 *
 * Two steps: the decision and its rationale, then a confirmation that
 * spells out what the decision does and shows the rationale exactly as it
 * will be published. Both steps go through the server action, so the page
 * works before it has hydrated. A refusal from the platform comes back to
 * the first step with what was chosen and written kept.
 */
export function ReviewForm(props: Props) {
  const { slug, methodName, version, versionId, reviewStatus, allowed, mode } = props;
  const [state, action, pending] = useActionState(recordReviewAction, initial);
  const choices = decisionChoices(reviewStatus, allowed);
  const echoed = state.status === 'confirm' ? undefined : state.values;

  const [decision, setDecision] = useState<string>(
    echoed?.decision ?? (choices.length === 1 ? (choices[0]?.to ?? '') : ''),
  );
  const [rationale, setRationale] = useState<string>(echoed?.rationale ?? '');
  const [seenState, setSeenState] = useState(state);
  // Counts the answers from the server. The form is mounted anew for each:
  // after a form action the browser resets the form, which unticks a radio
  // React still believes ticked.
  const [answer, setAnswer] = useState(0);
  if (state !== seenState) {
    // A new answer from the server: take the values it echoes.
    setSeenState(state);
    setAnswer((n) => n + 1);
    if (state.status !== 'confirm' && state.values) {
      setDecision(state.values.decision);
      setRationale(state.values.rationale);
    }
  }

  const headingRef = useRef<HTMLHeadingElement>(null);
  const confirmRef = useRef<HTMLHeadingElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const decisionRef = useRef<HTMLFieldSetElement>(null);
  const ids = useId();
  const rationaleId = `${ids}-rationale`;
  useEffect(() => {
    // Move focus with the step, so a keyboard or screen-reader user lands
    // on what changed: the confirmation, the reason it was refused, or the
    // field to correct.
    if (state.status === 'confirm') confirmRef.current?.focus();
    else if (state.status === 'error' && state.message) alertRef.current?.focus();
    else if (state.status === 'error' && state.decisionError) {
      decisionRef.current?.querySelector('input')?.focus();
    } else if (state.status === 'error') document.getElementById(rationaleId)?.focus();
    else if (state.status === 'idle' && state.values) headingRef.current?.focus();
  }, [state, rationaleId]);

  const decisionErrorId = `${ids}-decision-err`;

  // Nothing is open to this caller and nothing to report: no form.
  if (choices.length === 0 && state.status !== 'error') return null;

  const heading = mode === 'withdraw' ? REVIEW_TEXT.withdrawHeading : REVIEW_TEXT.reviewHeading;
  const hidden = (
    <>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="versionId" value={versionId} />
      <input type="hidden" name="expectedStatus" value={reviewStatus} />
    </>
  );

  if (state.status === 'confirm') {
    const text = decisionText(state.to);
    const choice = choices.find((c) => c.to === state.to);
    const destructive = state.to === 'REJECTED' || state.to === 'WITHDRAWN';
    const confirmHeading = REVIEW_TEXT.confirmHeading(text.confirm, version, methodName);
    return (
      <section
        id={`review-${versionId}`}
        aria-labelledby={`${ids}-confirm`}
        className="scroll-mt-24 rounded-xl border-2 border-[var(--color-warning)] bg-[var(--color-warning-soft)] p-5 sm:p-6"
      >
        <form action={action} className="space-y-5">
          {hidden}
          <input type="hidden" name="decision" value={state.to} />
          <input type="hidden" name="rationale" value={state.rationale} />
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
              {heading}
            </p>
            <h3
              id={`${ids}-confirm`}
              ref={confirmRef}
              tabIndex={-1}
              className="text-xl font-semibold tracking-tight focus:outline-none"
            >
              {confirmHeading}
            </h3>
            <p className="text-sm">{REVIEW_TEXT.confirmLead}</p>
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>{choice?.consequence ?? text.consequence}</li>
            <li>{text.finality}</li>
            {props.replacesRationale ? <li>{REVIEW_TEXT.replacesPrevious}</li> : null}
          </ul>
          <figure className="space-y-1">
            <figcaption className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
              {REVIEW_TEXT.publishedAs}
            </figcaption>
            <blockquote className="whitespace-pre-wrap break-words rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-4 text-sm">
              {state.rationale.length > 0 ? state.rationale : REVIEW_TEXT.noNote}
            </blockquote>
          </figure>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
            <Button
              type="submit"
              name="intent"
              value="edit"
              variant="outline"
              disabled={pending}
              className="h-11 sm:h-10"
            >
              {REVIEW_TEXT.backToEdit}
            </Button>
            <Button
              type="submit"
              name="intent"
              value="confirm"
              variant={destructive ? 'danger' : 'primary'}
              disabled={pending}
              className="h-11 sm:h-10"
            >
              {pending ? REVIEW_TEXT.recording : `${text.confirm} ${version}`}
            </Button>
          </div>
        </form>
      </section>
    );
  }

  const error = state.status === 'error' ? state : null;
  // An echoed decision no longer on offer (the version moved on) is not
  // the current choice.
  const current = choices.find((c) => c.to === decision)?.to ?? null;
  const needsRationale = current === null || reviewNeedsRationale(current);
  const optionalNote = current === 'UNDER_REVIEW';

  return (
    <section
      id={`review-${versionId}`}
      aria-labelledby={`${ids}-heading`}
      className="scroll-mt-24 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-subtle)] p-5 sm:p-6"
    >
      <h3
        id={`${ids}-heading`}
        ref={headingRef}
        tabIndex={-1}
        className="text-xl font-semibold tracking-tight focus:outline-none"
      >
        {heading}
      </h3>
      <p className="mt-2 max-w-prose text-sm text-[var(--color-muted-foreground)]">
        {mode === 'withdraw' ? REVIEW_TEXT.withdrawIntro : REVIEW_TEXT.reviewIntro}
      </p>

      {error?.message ? (
        <div ref={alertRef} tabIndex={-1} className="mt-4 focus:outline-none">
          <Alert tone="danger">
            <AlertTitle as="h4">{REVIEW_TEXT.notRecorded}</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      {choices.length === 0 ? (
        // The version moved on while the reviewer wrote: keep the text.
        <div className="mt-4 space-y-2">
          <p className="text-sm">{REVIEW_TEXT.noLongerOpen}</p>
          <Textarea aria-label={REVIEW_TEXT.rationaleLabel} readOnly rows={4} value={rationale} />
        </div>
      ) : (
        <form key={answer} action={action} className="mt-5 space-y-5">
          {hidden}
          <fieldset
            ref={decisionRef}
            className="space-y-2"
            aria-describedby={error?.decisionError ? decisionErrorId : undefined}
          >
            <legend className="text-sm font-medium">
              {REVIEW_TEXT.decisionLegend}
              <span aria-hidden="true" className="ms-0.5 text-[var(--color-danger)]">
                *
              </span>
            </legend>
            {error?.decisionError ? (
              <p id={decisionErrorId} className="text-xs text-[var(--color-danger)]">
                {error.decisionError}
              </p>
            ) : null}
            {choices.map((choice) => (
              <label
                key={choice.to}
                className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm has-[input:checked]:border-[var(--color-primary)] has-[input:checked]:bg-[var(--color-primary-soft)]"
              >
                <input
                  type="radio"
                  name="decision"
                  value={choice.to}
                  required
                  checked={decision === choice.to}
                  onChange={(event) => setDecision(event.currentTarget.value)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                />
                <span>
                  <span className="font-medium">{choice.label}.</span>{' '}
                  <span className="text-[var(--color-muted-foreground)]">{choice.consequence}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <Field
            label={optionalNote ? REVIEW_TEXT.noteLabel : REVIEW_TEXT.rationaleLabel}
            htmlFor={rationaleId}
            required={!optionalNote}
            hint={
              <>
                {optionalNote ? REVIEW_TEXT.noteHint : REVIEW_TEXT.rationaleHint}
                {props.replacesRationale ? ` ${REVIEW_TEXT.replacesPrevious}` : null}
              </>
            }
            error={error?.rationaleError}
          >
            <Textarea
              id={rationaleId}
              name="rationale"
              rows={5}
              maxLength={RATIONALE_MAX}
              required={needsRationale}
              invalid={Boolean(error?.rationaleError)}
              aria-describedby={error?.rationaleError ? `${rationaleId}-err` : undefined}
              value={rationale}
              onChange={(event) => setRationale(event.currentTarget.value)}
            />
          </Field>

          <div className="flex justify-end">
            <Button
              type="submit"
              name="intent"
              value="preview"
              disabled={pending}
              className="h-11 w-full sm:h-10 sm:w-auto"
            >
              {REVIEW_TEXT.continue}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
