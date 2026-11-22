'use client';

import { useActionState, useId, useMemo, useState } from 'react';
import type { DicomUndecidedFinding } from '@oci/shared-types';
import { Alert, AlertDescription, AlertTitle, Button, Field, Textarea } from '@oci/ui';
import { countOf, findingToken, groupFindings } from '../../../../lib/dicom-findings';
import { recordDecisionAction, type DecisionState } from './actions';

const initial: DecisionState = { status: 'idle' };

interface Props {
  slug: string;
  findings: DicomUndecidedFinding[];
}

/**
 * The operator's decision on the undecided findings of a dataset.
 *
 * Nothing is ticked to begin with: accepting a value is a statement
 * that it identifies nobody, and it has to be made, not left standing.
 * A whole attribute can be ticked at once, because one decision
 * usually applies to all of its values (every study date is shifted).
 */
export function ReviewForm({ slug, findings }: Props) {
  const [state, action, pending] = useActionState(recordDecisionAction, initial);
  const groups = useMemo(() => groupFindings(findings), [findings]);
  const reasonId = useId();

  // What is ticked is client state, so "all of this attribute" can work
  // and the summary can count. After an error the server echoes it.
  const echoed = state.status === 'error' ? state.values : undefined;
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(echoed?.selected ?? []));
  const [seenState, setSeenState] = useState(state);
  // Counts the answers received from the server. The boxes are mounted
  // anew for each one: after a form action the browser resets the form,
  // which unticks a box React still believes ticked.
  const [answer, setAnswer] = useState(0);
  if (state !== seenState) {
    // A new answer from the server: take its selection (empty after a
    // success, since the findings accepted are gone from the list).
    setSeenState(state);
    setAnswer((n) => n + 1);
    setSelected(new Set(state.status === 'error' ? (state.values?.selected ?? []) : []));
  }

  // Only what the platform will accept can be ticked: a value that
  // could not be read back, or that is shown cut, cannot be vouched for.
  const present = useMemo(
    () => new Set(findings.filter((f) => f.acceptable).map(findingToken)),
    [findings],
  );
  const ticked = [...selected].filter((token) => present.has(token));
  const toggle = (tokens: readonly string[], on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const token of tokens) {
        if (on) next.add(token);
        else next.delete(token);
      }
      return next;
    });

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="slug" value={slug} />

      {state.status === 'success' ? (
        <Alert tone="success">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      {state.status === 'error' ? (
        <Alert tone="danger">
          <AlertTitle as="h2">Not recorded</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      {findings.length === 0 ? (
        <Alert tone="success">
          <AlertDescription>Nothing is waiting for a decision on this dataset.</AlertDescription>
        </Alert>
      ) : null}

      <div key={answer} className="space-y-5">
        {groups.map((group) => {
          const tokens = group.findings.filter((f) => f.acceptable).map(findingToken);
          const allOn = tokens.length > 0 && tokens.every((token) => selected.has(token));
          const wholeFile = group.findings.some((f) => f.wholeFile);
          return (
            <fieldset
              key={group.attribute}
              className="rounded-lg border border-[var(--color-border)]"
            >
              <legend className="ms-3 px-1 text-base font-semibold">{group.kind.label}</legend>
              <div className="flex flex-col gap-2 px-4 pb-3 sm:flex-row sm:items-start sm:justify-between">
                <p className="max-w-prose text-sm text-[var(--color-muted-foreground)]">
                  {group.kind.hint}
                  {wholeFile ? (
                    <>
                      {' '}
                      Accepting it covers the images held now. An image uploaded later with the same
                      finding is held again.
                    </>
                  ) : null}
                </p>
                {tokens.length > 1 ? (
                  <label className="inline-flex min-h-11 shrink-0 items-center gap-2 text-sm sm:min-h-6">
                    <input
                      type="checkbox"
                      checked={allOn}
                      onChange={(event) => toggle(tokens, event.target.checked)}
                      className="h-4 w-4 accent-[var(--color-primary)]"
                    />
                    All {tokens.length} values
                  </label>
                ) : null}
              </div>
              <ul className="divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
                {group.findings.map((finding) => {
                  const token = findingToken(finding);
                  return (
                    <li key={token}>
                      <label
                        className={
                          'flex min-h-11 items-center gap-3 px-4 py-2' +
                          (finding.acceptable
                            ? ' cursor-pointer hover:bg-[var(--color-subtle)]'
                            : ' text-[var(--color-muted-foreground)]')
                        }
                      >
                        <input
                          type="checkbox"
                          name="finding"
                          value={token}
                          disabled={!finding.acceptable}
                          checked={finding.acceptable && selected.has(token)}
                          onChange={(event) => toggle([token], event.target.checked)}
                          className="h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                        />
                        <span className="min-w-0 flex-1 space-y-1">
                          {!group.kind.hasValue ? (
                            <span className="block text-sm text-[var(--color-muted-foreground)]">
                              No value to show
                            </span>
                          ) : finding.value === null ? (
                            <span className="block text-sm">
                              The value could not be read back from the file, so it cannot be
                              accepted.
                            </span>
                          ) : (
                            <span className="block break-all font-mono text-sm">
                              {finding.value}
                              {finding.valueTruncated ? '…' : null}
                            </span>
                          )}
                          {finding.valueTruncated ? (
                            <span className="block text-sm">
                              Only the beginning is shown: the value is too long to be shown whole,
                              so it cannot be accepted. The host has to correct the file.
                            </span>
                          ) : null}
                        </span>
                        <span className="shrink-0 text-end text-xs text-[var(--color-muted-foreground)]">
                          {countOf(finding.instanceCount, 'image', 'images')}
                          {' · '}
                          {countOf(finding.seriesCount, 'series', 'series')}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          );
        })}
      </div>

      {findings.length > 0 ? (
        <div className="space-y-4 rounded-lg bg-[var(--color-subtle)] p-4">
          <Field
            label="Reason"
            htmlFor={reasonId}
            required
            hint="Why these values identify nobody. It goes into the audit trail: do not repeat a value in it."
            error={state.status === 'error' ? state.reasonError : undefined}
          >
            <Textarea
              id={reasonId}
              name="reason"
              rows={3}
              required
              minLength={10}
              maxLength={2000}
              defaultValue={echoed?.reason ?? ''}
              // Remount after a success so the field empties.
              key={state.status === 'success' ? state.message : 'reason'}
            />
          </Field>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p role="status" className="text-sm text-[var(--color-muted-foreground)]">
              {ticked.length === 0
                ? 'Nothing selected.'
                : `${countOf(ticked.length, 'finding', 'findings')} selected of ${findings.length}.`}
            </p>
            <Button type="submit" disabled={pending || ticked.length === 0} className="h-11 sm:h-9">
              {pending ? 'Recording…' : 'Accept the selected findings'}
            </Button>
          </div>
          <p className="max-w-prose text-xs text-[var(--color-muted-foreground)]">
            An image is released when every one of its findings is accepted. A decision cannot be
            undone here. An accepted value is also accepted in files uploaded later; a finding about
            a file as a whole is not.
          </p>
        </div>
      ) : null}
    </form>
  );
}
