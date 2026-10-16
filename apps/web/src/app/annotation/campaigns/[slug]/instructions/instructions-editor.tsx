'use client';

import { useActionState, useId, useMemo, useRef, useState } from 'react';
import { Alert, AlertDescription, AlertTitle, Button, Field, Input, Textarea } from '@oci/ui';
import { INSTRUCTIONS_MARKDOWN_MAX_BYTES } from '@oci/shared-types';
import {
  publishInstructionsAction,
  type MediaRowValues,
  type PublishInstructionsState,
  type PublishInstructionsValues,
} from './actions';

const MAX_MEDIA = 20;
const initial: PublishInstructionsState = { status: 'idle' };
const encoder = new TextEncoder();
const fmt = (n: number) => n.toLocaleString('en-GB');

const selectClass =
  'h-10 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-base sm:text-sm text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]';

interface Row extends MediaRowValues {
  /** Stable React key; never sent. */
  key: number;
}

/**
 * Keys feed the inputs' ids, so they must match between the server
 * render and hydration: initial rows are numbered by position, and
 * rows added later take numbers from a per-editor counter above them.
 */
const toRows = (media: MediaRowValues[]): Row[] => media.map((m, i) => ({ ...m, key: i }));

export interface InstructionsEditorProps {
  slug: string;
  /** Version in effect when the page rendered; tells "unchanged" from "restored". */
  currentVersion: string | null;
  /** Pre-filled from the current version so an edit starts from it. */
  initialValues: PublishInstructionsValues;
}

/**
 * Manager editor for campaign instructions (#555). Both the body and
 * the media rows are controlled, so typed values survive a validation
 * error and the byte count stays live. Over-limit bodies can still be
 * submitted: the server action rejects them and echoes the text back.
 */
export function InstructionsEditor({
  slug,
  currentVersion,
  initialValues,
}: InstructionsEditorProps) {
  const [state, action, pending] = useActionState(publishInstructionsAction, initial);
  const [markdownBody, setMarkdownBody] = useState(initialValues.markdownBody);
  const [rows, setRows] = useState<Row[]>(() => toRows(initialValues.media));
  const nextKey = useRef(MAX_MEDIA);
  // Cancel hides the last result without a new submit; a later submit
  // returns a new state object, which shows again.
  const [dismissed, setDismissed] = useState<PublishInstructionsState | null>(null);
  const result = state === dismissed ? initial : state;
  const baseId = useId();

  // `initialValues` follows the current version: after a publish the
  // page re-renders, so Cancel reverts to what was just published.
  const dirty =
    markdownBody !== initialValues.markdownBody ||
    JSON.stringify(rows.map(({ url, kind, caption }) => [url, kind, caption])) !==
      JSON.stringify(initialValues.media.map(({ url, kind, caption }) => [url, kind, caption]));

  const cancel = () => {
    setMarkdownBody(initialValues.markdownBody);
    setRows(toRows(initialValues.media));
    setDismissed(state);
  };

  const bytes = useMemo(() => encoder.encode(markdownBody).length, [markdownBody]);
  const overLimit = bytes > INSTRUCTIONS_MARKDOWN_MAX_BYTES;
  const errors = result.status === 'error' ? (result.fieldErrors ?? {}) : {};
  const bodyError = errors['markdownBody'];

  const updateRow = (key: number, patch: Partial<MediaRowValues>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <form action={action} className="space-y-5" aria-busy={pending || undefined} noValidate>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="currentVersion" value={currentVersion ?? ''} />

      {result.status === 'error' ? (
        <Alert tone="danger">
          <AlertTitle as="h3">Could not publish the instructions</AlertTitle>
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      ) : result.status === 'published' ? (
        <Alert tone={result.mediaIgnored ? 'warning' : 'success'} role="status">
          <AlertTitle as="h3">
            {result.outcome === 'new' ? (
              <>
                Published version <span className="font-mono">{result.version}</span>
              </>
            ) : result.outcome === 'unchanged' ? (
              <>
                No change: version <span className="font-mono">{result.version}</span> is still
                current
              </>
            ) : (
              <>
                Version <span className="font-mono">{result.version}</span> is current again
              </>
            )}
          </AlertTitle>
          {result.mediaIgnored ? (
            <AlertDescription>
              The media changes were not saved. A new version is only created when the text changes,
              so edit the text as well to publish new media.
            </AlertDescription>
          ) : null}
        </Alert>
      ) : null}

      <Field
        label="Instructions (Markdown)"
        htmlFor={`${baseId}-body`}
        error={bodyError}
        hint={
          <span className={overLimit ? 'font-medium text-[var(--color-danger)]' : undefined}>
            <span className="tabular-nums">
              {fmt(bytes)} of {fmt(INSTRUCTIONS_MARKDOWN_MAX_BYTES)} bytes (64 KB)
            </span>
            {overLimit ? ' — over the limit' : null}. Raw HTML is shown as text.
          </span>
        }
      >
        <Textarea
          id={`${baseId}-body`}
          name="markdownBody"
          rows={14}
          value={markdownBody}
          onChange={(e) => setMarkdownBody(e.target.value)}
          invalid={!!bodyError || overLimit}
          aria-describedby={bodyError ? `${baseId}-body-err` : undefined}
          spellCheck
          className="font-mono"
        />
      </Field>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Media</legend>
        <p className="text-xs text-[var(--color-muted-foreground)]">
          Images and videos shown under the text, up to {MAX_MEDIA}. Rows left blank are ignored.
        </p>
        {errors['media'] ? (
          <p className="text-xs text-[var(--color-danger)]">{errors['media']}</p>
        ) : null}
        {rows.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">No media.</p>
        ) : (
          <ol className="space-y-3">
            {rows.map((row, i) => {
              const id = `${baseId}-media-${row.key}`;
              const urlError = errors[`media.${i}.url`];
              const captionError = errors[`media.${i}.caption`];
              return (
                <li
                  key={row.key}
                  className="rounded-md border border-[var(--color-border)] p-3"
                  aria-label={`Media ${i + 1}`}
                >
                  <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
                    <Field label="URL" htmlFor={`${id}-url`} error={urlError}>
                      <Input
                        id={`${id}-url`}
                        name="mediaUrl"
                        type="text"
                        inputMode="url"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="https://"
                        value={row.url}
                        onChange={(e) => updateRow(row.key, { url: e.target.value })}
                        invalid={!!urlError}
                        aria-describedby={urlError ? `${id}-url-err` : undefined}
                      />
                    </Field>
                    <Field label="Type" htmlFor={`${id}-kind`}>
                      <select
                        id={`${id}-kind`}
                        name="mediaKind"
                        value={row.kind}
                        onChange={(e) => updateRow(row.key, { kind: e.target.value })}
                        className={selectClass}
                      >
                        <option value="image">Image</option>
                        <option value="video">Video</option>
                      </select>
                    </Field>
                  </div>
                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <Field
                      label="Caption"
                      htmlFor={`${id}-caption`}
                      error={captionError}
                      className="min-w-0 flex-1"
                    >
                      <Input
                        id={`${id}-caption`}
                        name="mediaCaption"
                        value={row.caption}
                        onChange={(e) => updateRow(row.key, { caption: e.target.value })}
                        invalid={!!captionError}
                        aria-describedby={captionError ? `${id}-caption-err` : undefined}
                      />
                    </Field>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
                      aria-label={`Remove media ${i + 1}`}
                      className="h-10"
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={rows.length >= MAX_MEDIA}
          onClick={() =>
            setRows((rs) => [
              ...rs,
              { url: '', kind: 'image', caption: '', key: nextKey.current++ },
            ])
          }
        >
          Add media
        </Button>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Publishing…' : 'Publish'}
        </Button>
        <Button type="button" variant="danger" onClick={cancel} disabled={pending || !dirty}>
          Cancel
        </Button>
        <p className="text-xs text-[var(--color-muted-foreground)]">
          Publishing makes this the version annotators see. Cancel discards unpublished edits.
        </p>
      </div>
    </form>
  );
}
