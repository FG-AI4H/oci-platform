'use server';

import { revalidatePath } from 'next/cache';
import {
  SeedTasksFromDatasetRequestSchema,
  SeedTasksRequestSchema,
  type SeedTasksFromDatasetResponse,
  type SeedTasksResponse,
} from '@oci/shared-types';
import { fetchAsUser } from '../../../../lib/api-action';
import { isCampaignManager } from '../../../../lib/groups';
import { sessionForAction } from '../../../../lib/session-recovery';

export type SeedTasksState =
  | { status: 'idle' }
  | { status: 'success'; created: number; skipped: number; message: string; sampleRefs: string }
  | { status: 'error'; message: string; sampleRefs: string };

/**
 * Seed a batch of AnnotationTask rows on a RUNNING / READY campaign
 * (#215 slice 2). Takes a newline-separated `sampleRefs` textarea and
 * forwards as an array to `POST /v2/annotation/campaigns/:slug/tasks`.
 *
 * Echo-on-error: returns the submitted sampleRefs string verbatim so
 * the form can re-render with the operator's input intact (project
 * convention — see access-request + campaign-create actions).
 */
export async function seedTasksAction(
  _prev: SeedTasksState,
  formData: FormData,
): Promise<SeedTasksState> {
  const session = await sessionForAction();
  const sampleRefsRaw = String(formData.get('sampleRefs') ?? '');
  if (!session?.user || !isCampaignManager(session)) {
    return {
      status: 'error',
      message: 'Only campaign managers can seed tasks.',
      sampleRefs: sampleRefsRaw,
    };
  }
  const slug = String(formData.get('slug') ?? '');
  if (!slug) {
    return { status: 'error', message: 'Missing campaign slug.', sampleRefs: sampleRefsRaw };
  }

  const sampleRefs = sampleRefsRaw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sampleRefs.length === 0) {
    return {
      status: 'error',
      message: 'Paste at least one sample reference (one per line).',
      sampleRefs: sampleRefsRaw,
    };
  }
  const parsed = SeedTasksRequestSchema.safeParse({ sampleRefs });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Invalid sample references.',
      sampleRefs: sampleRefsRaw,
    };
  }

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    return {
      status: 'error',
      message: 'NEXT_PUBLIC_API_BASE_URL not set in web env.',
      sampleRefs: sampleRefsRaw,
    };
  }
  const res = await fetchAsUser(
    `${base}/v2/annotation/campaigns/${encodeURIComponent(slug)}/tasks`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sampleRefs }),
      cache: 'no-store',
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      status: 'error',
      message: `API ${res.status} ${res.statusText}: ${body.slice(0, 300)}`,
      sampleRefs: sampleRefsRaw,
    };
  }
  const out = (await res.json()) as SeedTasksResponse;
  revalidatePath(`/annotation/campaigns/${slug}`);

  const noun = out.created === 1 ? 'task' : 'tasks';
  const skipped = out.skipped > 0 ? ` (${out.skipped} skipped as duplicates)` : '';
  return {
    status: 'success',
    created: out.created,
    skipped: out.skipped,
    message: `Created ${out.created} ${noun}${skipped}.`,
    // Clear the textarea on success so the next paste starts fresh.
    sampleRefs: '',
  };
}

export type SeedFromDatasetState =
  | { status: 'idle' }
  | {
      status: 'preview';
      matched: number;
      toCreate: number;
      alreadyThere: number;
      prefix: string;
      limit: string;
    }
  | { status: 'success'; message: string; prefix: string; limit: string }
  | { status: 'error'; message: string; prefix: string; limit: string };

/**
 * "Create tasks from the dataset's files" (#646), in two steps: `intent`
 * `preview` counts the matching image files without creating anything,
 * and `create` creates the tasks. The count is shown between the two so
 * the manager confirms what will happen.
 */
export async function seedFromDatasetAction(
  _prev: SeedFromDatasetState,
  formData: FormData,
): Promise<SeedFromDatasetState> {
  const prefix = String(formData.get('prefix') ?? '').trim();
  const limit = String(formData.get('limit') ?? '').trim();
  const fail = (message: string): SeedFromDatasetState => ({
    status: 'error',
    message,
    prefix,
    limit,
  });

  const session = await sessionForAction();
  if (!session?.user || !isCampaignManager(session)) {
    return fail('Only campaign managers can create tasks.');
  }
  const slug = String(formData.get('slug') ?? '');
  if (!slug) return fail('Missing campaign slug.');
  const dryRun = formData.get('intent') !== 'create';

  const parsed = SeedTasksFromDatasetRequestSchema.safeParse({
    dryRun,
    ...(prefix ? { prefix } : {}),
    ...(limit ? { limit: Number(limit) } : {}),
  });
  if (!parsed.success) {
    return fail(
      parsed.error.issues[0]?.path[0] === 'limit'
        ? 'The limit must be a whole number between 1 and 10,000.'
        : (parsed.error.issues[0]?.message ?? 'Invalid options.'),
    );
  }

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) return fail('NEXT_PUBLIC_API_BASE_URL not set in web env.');
  const res = await fetchAsUser(
    `${base}/v2/annotation/campaigns/${encodeURIComponent(slug)}/tasks/from-dataset`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(parsed.data),
      cache: 'no-store',
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
    const detail =
      typeof body?.message === 'string' ? body.message : `${res.status} ${res.statusText}`;
    return fail(`Could not ${dryRun ? 'count' : 'create'} tasks: ${detail}`);
  }
  const out = (await res.json()) as SeedTasksFromDatasetResponse;
  if (dryRun) {
    return {
      status: 'preview',
      matched: out.matched,
      toCreate: out.created,
      alreadyThere: out.skipped,
      prefix,
      limit,
    };
  }
  revalidatePath(`/annotation/campaigns/${slug}`);
  const noun = out.created === 1 ? 'task' : 'tasks';
  const skipped = out.skipped > 0 ? ` ${out.skipped} files already had a task.` : '';
  return { status: 'success', message: `Created ${out.created} ${noun}.${skipped}`, prefix, limit };
}
