'use client';

import Link from 'next/link';
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Alert, AlertDescription, AlertTitle, Button, Field, Input } from '@oci/ui';
import type { FormatReportView } from '../../../../components/evaluation/format-report';
import type { QuotaText } from '../../../../components/evaluation/quota-text';
import { submitPredictionsAction, type SubmitPredictionsState } from './actions';
import { MAX_PREDICTIONS_FILE_BYTES, MAX_PREDICTIONS_FILE_LABEL } from './limits';

/**
 * Whether the reader can submit for scoring, decided on the server. The token
 * never comes here: the form only learns which of these four cases it is in.
 */
export type ScoringAccess =
  | { kind: 'signed-out' }
  /** Signed in, but the API no longer accepts the session's token. */
  | { kind: 'expired' }
  | { kind: 'ready'; quota: QuotaText }
  /** Signed in, but the remaining submissions could not be read just now. */
  | { kind: 'unknown' };

const initial: SubmitPredictionsState = { status: 'idle' };

const n = (value: number) => value.toLocaleString('en-GB');

/**
 * The submit form (#645): a method name, a file, and two buttons that post the
 * same form — "Check format" (free, no account) and "Submit for scoring".
 *
 * The form is submitted from `onSubmit` rather than through the `action`
 * attribute alone. React resets a form after its action completes, which would
 * clear the chosen file after every "Check format" and make the reader pick it
 * again before submitting. Calling the action inside a transition keeps the
 * file selected. `action` is still set, so the form works before the script
 * has loaded: the button's `intent` travels with a plain form post.
 */
export function SubmitPredictionsForm({ slug, access }: { slug: string; access: ScoringAccess }) {
  const [state, formAction, pending] = useActionState(
    submitPredictionsAction.bind(null, slug),
    initial,
  );
  const [, startTransition] = useTransition();
  const [intent, setIntent] = useState<'check' | 'submit'>('check');
  /** Problems found in the browser, before anything is sent. */
  const [local, setLocal] = useState<{ methodName?: string; file?: string }>({});
  /** True once the file or the name changed after a result was shown. */
  const [stale, setStale] = useState(false);

  const resultRef = useRef<HTMLDivElement>(null);
  const methodNameRef = useRef<HTMLInputElement>(null);

  // A result belongs to the file it was computed for. Once the reader picks
  // another file it is hidden, so a green "valid" never sits above a file that
  // was not the one checked.
  const shown: SubmitPredictionsState = stale ? initial : state;

  // Bring the result into view when it arrives: on a phone it can be above or
  // below what is on screen. Focus stays on the button that was pressed; the
  // result is announced by the alert it is rendered in.
  useEffect(() => {
    if (state.status !== 'idle') resultRef.current?.scrollIntoView({ block: 'nearest' });
  }, [state]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(event.currentTarget, submitter);
    const next = data.get('intent') === 'submit' ? 'submit' : 'check';

    const problems: { methodName?: string; file?: string } = {};
    if (next === 'submit' && String(data.get('methodName') ?? '').trim() === '') {
      problems.methodName = 'Give your method a name. It is shown with the result.';
    }
    const file = data.get('file');
    if (file instanceof File && file.size > MAX_PREDICTIONS_FILE_BYTES) {
      problems.file = `This file is larger than ${MAX_PREDICTIONS_FILE_LABEL}, the most this page takes.`;
    }
    setLocal(problems);
    if (problems.methodName || problems.file) {
      setStale(true);
      if (problems.methodName) methodNameRef.current?.focus();
      return;
    }

    setIntent(next);
    setStale(false);
    startTransition(() => formAction(data));
  }

  const echoed = state.status === 'idle' ? undefined : state.values;
  const methodNameError =
    local.methodName ?? (shown.status === 'error' ? shown.methodNameError : undefined);
  const fileError = local.file ?? (shown.status === 'error' ? shown.fileError : undefined);
  const hasResult = shown.status !== 'idle';

  const canSubmit =
    access.kind === 'unknown' || (access.kind === 'ready' && access.quota.available);
  // The filled button is the next step: check first, and submit once the file
  // on screen has passed. Both stay usable either way; submitting an unchecked
  // file checks it first.
  const checked = shown.status === 'checked' && shown.report.ok;
  const callbackUrl = encodeURIComponent(`/evaluation/${slug}/submit`);

  return (
    <form
      action={formAction}
      onSubmit={onSubmit}
      className="space-y-6"
      aria-busy={pending || undefined}
    >
      <Field
        label="Method name"
        htmlFor="field-method-name"
        hint="For example “first reading” or “model v2”. Shown publicly with the result, so leave people’s names out. Needed to submit for scoring."
        error={methodNameError}
      >
        <Input
          ref={methodNameRef}
          id="field-method-name"
          name="methodName"
          defaultValue={echoed?.methodName}
          maxLength={120}
          autoComplete="off"
          invalid={!!methodNameError}
          aria-describedby={methodNameError ? 'field-method-name-err' : undefined}
          onChange={() => setLocal((l) => ({ ...l, methodName: undefined }))}
        />
      </Field>

      <div className="space-y-3">
        <Field
          label="Predictions file"
          htmlFor="field-file"
          required
          hint={`The template with your labels filled in (CSV), or a JSON file. Up to ${MAX_PREDICTIONS_FILE_LABEL}.`}
          error={fileError}
        >
          <Input
            id="field-file"
            name="file"
            type="file"
            required
            accept=".csv,.json,text/csv,application/json"
            invalid={!!fileError}
            aria-describedby={
              [fileError ? 'field-file-err' : null, hasResult ? 'submit-result' : null]
                .filter(Boolean)
                .join(' ') || undefined
            }
            onChange={() => {
              setStale(true);
              setLocal((l) => ({ ...l, file: undefined }));
            }}
            className="h-auto cursor-pointer py-2 file:me-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-[var(--color-muted)] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-[var(--color-foreground)]"
          />
        </Field>

        {/* Everything the check or the submission found, directly under the file it is about. */}
        <div id="submit-result" ref={resultRef} className="scroll-mt-24">
          {shown.status === 'error' ? <ErrorResult state={shown} slug={slug} /> : null}
          {shown.status === 'checked' ? (
            <FormatReport
              report={shown.report}
              fileName={shown.fileName}
              heading={shown.report.ok ? 'The format is valid' : problemHeading(shown.report)}
              footer={
                shown.report.ok
                  ? access.kind === 'signed-out'
                    ? 'Sign in to submit this file for scoring.'
                    : 'You can submit this file for scoring.'
                  : 'Correct the file, choose it again, and check it once more. Nothing was scored.'
              }
            />
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-4 border-t border-[var(--color-border)] pt-5 sm:flex-row sm:items-start sm:justify-between">
        {/* First in the document, so pressing Enter in a field checks rather than submits. */}
        <Button
          type="submit"
          name="intent"
          value="check"
          variant={checked ? 'secondary' : 'primary'}
          size="lg"
          disabled={pending}
        >
          {pending && intent === 'check' ? 'Checking…' : 'Check format'}
        </Button>

        <div className="flex flex-col gap-2 sm:items-end">
          {access.kind === 'signed-out' || access.kind === 'expired' ? (
            <>
              <Button asChild size="lg" variant={checked ? 'primary' : 'outline'}>
                {access.kind === 'expired' ? (
                  <Link href={`/signin?reason=expired&callbackUrl=${callbackUrl}`}>
                    Sign in again to submit for scoring
                  </Link>
                ) : (
                  <Link href={`/signin?callbackUrl=${callbackUrl}`}>
                    Sign in to submit for scoring
                  </Link>
                )}
              </Button>
              <p className="text-sm text-[var(--color-muted-foreground)] sm:text-end">
                {access.kind === 'expired'
                  ? 'Your session has expired. Checking the format still works.'
                  : 'Checking the format needs no account.'}
              </p>
            </>
          ) : (
            <>
              <Button
                type="submit"
                name="intent"
                value="submit"
                variant={checked ? 'primary' : 'outline'}
                size="lg"
                disabled={pending || !canSubmit}
                aria-describedby="quota-note"
              >
                {pending && intent === 'submit' ? 'Submitting…' : 'Submit for scoring'}
              </Button>
              <p id="quota-note" className="max-w-sm text-sm sm:text-end">
                {access.kind === 'ready' ? (
                  <>
                    <span className="block font-medium text-[var(--color-foreground)]">
                      {access.quota.summary}
                    </span>
                    <span className="block text-[var(--color-muted-foreground)]">
                      {access.quota.detail}
                    </span>
                  </>
                ) : (
                  <span className="text-[var(--color-muted-foreground)]">
                    The number of scored submissions you have left could not be read just now.
                  </span>
                )}
              </p>
            </>
          )}
        </div>
      </div>
    </form>
  );
}

function problemHeading(report: FormatReportView): string {
  const count = report.problems.length;
  return count === 1 ? 'The file has 1 problem to fix' : `The file has ${n(count)} problems to fix`;
}

/** A failed check or a refused submission, with whatever detail came with it. */
function ErrorResult({
  state,
  slug,
}: {
  state: Extract<SubmitPredictionsState, { status: 'error' }>;
  slug: string;
}) {
  if (state.report) {
    return (
      <FormatReport
        report={state.report}
        fileName={state.fileName ?? 'the file'}
        heading={state.message}
        footer="Correct the file, choose it again, and check it once more."
      />
    );
  }

  return (
    <Alert tone="danger">
      <AlertTitle as="h3">{state.message}</AlertTitle>
      {state.fileIssues ? (
        <AlertDescription className="mt-3 space-y-2">
          <ul className="space-y-1.5 text-[var(--color-foreground)]">
            {state.fileIssues.issues.map((issue, i) => (
              <li key={i} className="break-words">
                {issue.line !== null ? (
                  <span className="font-medium">Line {n(issue.line)}: </span>
                ) : null}
                {issue.message}
              </li>
            ))}
          </ul>
          {state.fileIssues.issueCount > state.fileIssues.issues.length ? (
            <p>
              and {n(state.fileIssues.issueCount - state.fileIssues.issues.length)} more. The first
              ones are listed; the rest are usually the same mistake.
            </p>
          ) : null}
          {state.fileIssues.missingLabelCount > 0 ? (
            <p>Where a label is missing, type it in, or delete the line to leave that item out.</p>
          ) : null}
          <p className="font-medium text-[var(--color-foreground)]">
            Correct the file, choose it again, and check it once more.
          </p>
        </AlertDescription>
      ) : null}
      {state.failedSubmissionId ? (
        <AlertDescription className="mt-2">
          <Link
            href={`/evaluation/${encodeURIComponent(slug)}/submissions/${state.failedSubmissionId}`}
            className="rounded font-medium text-[var(--color-primary)] underline underline-offset-2 hover:text-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
          >
            See the failed attempt
          </Link>
        </AlertDescription>
      ) : null}
    </Alert>
  );
}

/** What the format check found: what must be fixed, and what was left out. */
function FormatReport({
  report,
  fileName,
  heading,
  footer,
}: {
  report: FormatReportView;
  fileName: string;
  heading: string;
  footer: string;
}) {
  return (
    <div className="space-y-3">
      <Alert tone={report.ok ? 'success' : 'danger'}>
        <AlertTitle as="h3">{heading}</AlertTitle>
        <AlertDescription className="mt-2 space-y-4">
          <p>
            <span className="break-all font-mono text-xs">{fileName}</span>: {n(report.rowCount)}{' '}
            {report.rowCount === 1 ? 'line' : 'lines'} read, matching {n(report.recognised)} of the{' '}
            {n(report.taskItemCount)} items in this task.
          </p>

          {/* Binary-finding tasks only: whether the result will include an AUC. */}
          {report.scoreNote ? <p>{report.scoreNote}</p> : null}

          {report.problems.map((problem) => (
            <ReportSection key={problem.key} title={problem.title} count={problem.itemIdCount}>
              <p>{problem.detail}</p>
              <ItemIdList itemIds={problem.itemIds} total={problem.itemIdCount} />
            </ReportSection>
          ))}

          <p className="font-medium text-[var(--color-foreground)]">{footer}</p>
        </AlertDescription>
      </Alert>

      {/*
       * Items left out are allowed, so they sit outside the verdict and stay
       * folded: inside a red box, twenty identifiers that need no action would
       * outweigh the two that do.
       */}
      {report.missing.count > 0 ? (
        <details className="rounded-lg border border-[var(--color-border)] bg-[var(--color-subtle)] p-4 text-sm">
          <summary className="cursor-pointer rounded font-medium text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]">
            {n(report.missing.count)} {report.missing.count === 1 ? 'item has' : 'items have'} no
            prediction. That is allowed.
          </summary>
          <div className="mt-3 space-y-2 text-[var(--color-muted-foreground)]">
            <p>They are left out of the scoring and show as lower coverage in the result.</p>
            <ItemIdList itemIds={report.missing.itemIds} total={report.missing.count} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function ReportSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <h4 className="font-medium text-[var(--color-foreground)]">
        {title}
        {count > 0 ? <span className="tabular-nums"> ({n(count)})</span> : null}
      </h4>
      {children}
    </section>
  );
}

function ItemIdList({ itemIds, total }: { itemIds: readonly string[]; total: number }) {
  if (itemIds.length === 0) return null;
  return (
    <>
      <ul className="flex flex-wrap gap-1.5">
        {itemIds.map((id) => (
          <li
            key={id}
            className="max-w-full break-all rounded border border-[var(--color-border)] bg-[var(--color-card)] px-1.5 py-0.5 font-mono text-xs text-[var(--color-foreground)]"
          >
            {id}
          </li>
        ))}
      </ul>
      {total > itemIds.length ? <p>and {n(total - itemIds.length)} more.</p> : null}
    </>
  );
}
