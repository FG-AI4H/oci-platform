'use server';

import { revalidatePath } from 'next/cache';
import { SeedTasksRequestSchema, type SeedTasksResponse } from '@oci/shared-types';
import { auth } from '../../../../auth';
import { isCampaignManager } from '../../../../lib/groups';

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
  const session = await auth();
  const sampleRefsRaw = String(formData.get('sampleRefs') ?? '');
  if (!session?.accessToken || !isCampaignManager(session)) {
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
  const res = await fetch(`${base}/v2/annotation/campaigns/${encodeURIComponent(slug)}/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify({ sampleRefs }),
    cache: 'no-store',
  });
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
