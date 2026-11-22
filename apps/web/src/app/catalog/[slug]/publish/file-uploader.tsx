'use client';

import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { UploadedDistribution } from '@oci/shared-types';
import { Alert, AlertDescription, AlertTitle, Button } from '@oci/ui';
import { useFormatters } from '../../../../i18n/client';
import { uploadMultipart, type UploadTransport } from '../../../../lib/multipart-upload';
import { revalidateDatasetDetail } from './actions';
import {
  abortUploadAction,
  completeUploadAction,
  initUploadAction,
  uploadPartUrlAction,
  type UploadCallResult,
} from './upload-actions';

interface Props {
  slug: string;
}

function unwrap<T>(result: UploadCallResult<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

/**
 * The upload's API calls go through server actions, which hold the
 * session. The browser gets a presigned URL per part and never a
 * bearer token.
 */
function serverTransport(slug: string): UploadTransport {
  return {
    init: async (request) => unwrap(await initUploadAction(slug, request)),
    partUrl: async (ref, partNumber) => unwrap(await uploadPartUrlAction(slug, ref, partNumber)),
    complete: async (ref, file, body) => unwrap(await completeUploadAction(slug, ref, file, body)),
    abort: async (ref) => {
      unwrap(await abortUploadAction(slug, ref));
    },
  };
}

interface UploadingFile {
  id: string;
  file: File;
  fraction: number;
  status: 'uploading' | 'done' | 'error';
  error: string | null;
  distribution: UploadedDistribution | null;
  controller: AbortController;
}

/**
 * File uploader on the publish page (PR I, #87). Drag-drop or pick;
 * the multipart helper handles parallel parts + retry + within-session
 * resume. Each successful upload yields a `contentUrl` the host
 * pastes into the manifest's `distribution[]`.
 *
 * Conscious omissions:
 *   - No batch-upload UI for thousands of files. Real datasets at
 *     that scale go via the CLI tool (#88).
 *   - No per-part progress (just per-file). Avoids re-rendering on
 *     every chunk; the granularity above is enough.
 *   - No SHA-256 compute by default. Reading a 10 GB file twice in
 *     the browser is hostile; the manifest carries hashes when the
 *     host already has them.
 */
export function FileUploader({ slug }: Props) {
  const t = useTranslations('Publish');
  const f = useFormatters();
  const [files, setFiles] = useState<UploadingFile[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const handlePicked = useCallback(
    (picked: FileList | File[]) => {
      const incoming = Array.from(picked);
      const transport = serverTransport(slug);
      const next: UploadingFile[] = incoming.map((file) => ({
        // Stable identity for state updates. Reference equality (`f ===
        // entry`) breaks the moment `onProgress` setFiles spreads the
        // entry into a new object — subsequent `done`/`error`
        // transitions then fail to find their row, leaving the UI
        // stuck at "uploading 0%". The id is the seam.
        id: crypto.randomUUID(),
        file,
        fraction: 0,
        status: 'uploading',
        error: null,
        distribution: null,
        controller: new AbortController(),
      }));
      setFiles((prev) => [...prev, ...next]);

      next.forEach((entry) => {
        const id = entry.id;
        uploadMultipart({
          slug,
          file: entry.file,
          transport,
          signal: entry.controller.signal,
          onProgress: (fraction) =>
            setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, fraction } : f))),
        })
          .then((res) => {
            setFiles((prev) =>
              prev.map((f) =>
                f.id === id
                  ? { ...f, status: 'done', fraction: 1, distribution: res.distribution }
                  : f,
              ),
            );
            // The upload does not revalidate anything by itself, so
            // the detail page's 30s cache hides the freshly-attached
            // distribution. Force a re-render via the server action.
            revalidateDatasetDetail(slug).catch(() => {
              /* best-effort */
            });
          })
          .catch((err) =>
            setFiles((prev) =>
              prev.map((f) =>
                f.id === id
                  ? {
                      ...f,
                      status: 'error',
                      error: err instanceof Error ? err.message : String(err),
                    }
                  : f,
              ),
            ),
          );
      });
    },
    [slug],
  );

  return (
    <div className="space-y-4">
      <Alert>
        <AlertTitle>{t('uploader.howTitle')}</AlertTitle>
        <AlertDescription>
          {t.rich('uploader.howBody', {
            code: (chunks) => <code className="font-mono text-xs">{chunks}</code>,
          })}
        </AlertDescription>
      </Alert>

      <div
        className="rounded-md border border-dashed border-[var(--color-border-strong)] bg-[var(--color-subtle)] p-6 text-center"
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files.length > 0) handlePicked(e.dataTransfer.files);
        }}
      >
        <p className="text-sm text-[var(--color-muted-foreground)]">{t('uploader.dropHere')}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => inputRef.current?.click()}
        >
          {t('uploader.choose')}
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          aria-label={t('uploader.chooseLabel')}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) handlePicked(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {files.length === 0 ? null : (
        <ul className="space-y-2">
          {files.map((entry) => (
            <li
              key={entry.id}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-3 text-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs">{entry.file.name}</p>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    {f.bytes(entry.file.size)}
                    {entry.status === 'uploading' ? <> · {f.percent(entry.fraction)}</> : null}
                  </p>
                </div>
                <UploadStatus entry={entry} />
              </div>
              {entry.status === 'uploading' ? (
                <progress
                  className="mt-2 w-full"
                  value={entry.fraction}
                  max={1}
                  aria-label={t('uploader.uploading', { name: entry.file.name })}
                />
              ) : null}
              {entry.status === 'done' && entry.distribution ? (
                <p className="mt-2 break-all font-mono text-xs">
                  contentUrl:{' '}
                  <span className="text-[var(--color-primary)]">
                    {entry.distribution.contentUrl}
                  </span>
                </p>
              ) : null}
              {entry.status === 'error' ? (
                <p className="mt-2 text-xs text-[var(--color-danger)]">{entry.error}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UploadStatus({ entry }: { entry: UploadingFile }) {
  const t = useTranslations('Publish');
  if (entry.status === 'done')
    return <span className="text-xs text-[var(--color-success)]">{t('uploader.done')}</span>;
  if (entry.status === 'error')
    return (
      <button
        type="button"
        className="text-xs text-[var(--color-danger)] underline"
        onClick={() => entry.controller.abort()}
      >
        {t('uploader.failed')}
      </button>
    );
  return (
    <button
      type="button"
      className="text-xs text-[var(--color-muted-foreground)] underline"
      onClick={() => entry.controller.abort()}
    >
      {t('uploader.cancel')}
    </button>
  );
}
