'use server';

import { revalidatePath } from 'next/cache';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  SeedTasksFromDatasetRequestSchema,
  SeedTasksRequestSchema,
  type SeedTasksFromDatasetResponse,
  type SeedTasksResponse,
} from '@oci/shared-types';
import { fetchAsUser } from '../../../../lib/api-action';
import { isCampaignManager } from '../../../../lib/groups';
import { zodParseParams } from '../../../../i18n/zod';
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
  const [t, common] = await Promise.all([
    getTranslations('Campaign.seedActions'),
    getTranslations('Common'),
  ]);
  const sampleRefsRaw = String(formData.get('sampleRefs') ?? '');
  if (!session?.user || !isCampaignManager(session)) {
    return { status: 'error', message: t('onlyManagersSeed'), sampleRefs: sampleRefsRaw };
  }
  const slug = String(formData.get('slug') ?? '');
  if (!slug) {
    return { status: 'error', message: t('missingSlug'), sampleRefs: sampleRefsRaw };
  }

  const sampleRefs = sampleRefsRaw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sampleRefs.length === 0) {
    return {
      status: 'error',
      message: t('pasteOne'),
      sampleRefs: sampleRefsRaw,
    };
  }
  const parsed = SeedTasksRequestSchema.safeParse({ sampleRefs }, await zodParams());
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? t('invalidRefs'),
      sampleRefs: sampleRefsRaw,
    };
  }

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    return { status: 'error', message: common('apiBaseUrlMissing'), sampleRefs: sampleRefsRaw };
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
    logRefusal('seed', res.status, await res.text().catch(() => ''));
    return { status: 'error', message: refusal(t, res.status), sampleRefs: sampleRefsRaw };
  }
  const out = (await res.json()) as SeedTasksResponse;
  revalidatePath(`/annotation/campaigns/${slug}`);

  return {
    status: 'success',
    created: out.created,
    skipped: out.skipped,
    message: t('seeded', { created: out.created, skipped: out.skipped }),
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
      /** DICOM series left out because an image of theirs is held (ADR-0026). */
      held: number;
      prefix: string;
      limit: string;
    }
  | { status: 'success'; message: string; prefix: string; limit: string }
  | { status: 'error'; message: string; prefix: string; limit: string };

/**
 * "Create tasks from the dataset's files" (#646), in two steps: `intent`
 * `preview` counts the matching image files and DICOM series without creating anything,
 * and `create` creates the tasks. The count is shown between the two so
 * the manager confirms what will happen.
 */
export async function seedFromDatasetAction(
  _prev: SeedFromDatasetState,
  formData: FormData,
): Promise<SeedFromDatasetState> {
  const prefix = String(formData.get('prefix') ?? '').trim();
  const limit = String(formData.get('limit') ?? '').trim();
  const [t, common] = await Promise.all([
    getTranslations('Campaign.seedActions'),
    getTranslations('Common'),
  ]);
  const fail = (message: string): SeedFromDatasetState => ({
    status: 'error',
    message,
    prefix,
    limit,
  });

  const session = await sessionForAction();
  if (!session?.user || !isCampaignManager(session)) {
    return fail(t('onlyManagersCreate'));
  }
  const slug = String(formData.get('slug') ?? '');
  if (!slug) return fail(t('missingSlug'));
  const dryRun = formData.get('intent') !== 'create';

  const parsed = SeedTasksFromDatasetRequestSchema.safeParse(
    {
      dryRun,
      ...(prefix ? { prefix } : {}),
      ...(limit ? { limit: Number(limit) } : {}),
    },
    await zodParams(),
  );
  if (!parsed.success) {
    return fail(
      parsed.error.issues[0]?.path[0] === 'limit'
        ? t('limitRange')
        : (parsed.error.issues[0]?.message ?? t('invalidOptions')),
    );
  }

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) return fail(common('apiBaseUrlMissing'));
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
    logRefusal('from-dataset', res.status, await res.text().catch(() => ''));
    // 403 here is the download rule (#646, question 1): the manager may
    // not download the files the tasks would show.
    return fail(res.status === 403 ? t('noDownloadAccess') : refusal(t, res.status));
  }
  const out = (await res.json()) as SeedTasksFromDatasetResponse;
  if (dryRun) {
    return {
      status: 'preview',
      matched: out.matched,
      toCreate: out.created,
      alreadyThere: out.skipped,
      held: out.held,
      prefix,
      limit,
    };
  }
  revalidatePath(`/annotation/campaigns/${slug}`);
  const tf = await getTranslations('Campaign.fromDataset');
  const message = [
    t('created', { created: out.created }),
    out.skipped > 0 ? t('alreadyHad', { count: out.skipped }) : null,
    out.held > 0 ? tf('held', { held: out.held }) : null,
  ]
    .filter(Boolean)
    .join(' ');
  return {
    status: 'success',
    message,
    prefix,
    limit,
  };
}

type SeedTranslator = Awaited<ReturnType<typeof getTranslations<'Campaign.seedActions'>>>;

/** A refused call, in the manager's language; the API's body goes to the log. */
function refusal(t: SeedTranslator, status: number): string {
  if (status === 403) return t('forbidden');
  if (status === 404) return t('campaignNotFound');
  if (status === 409) return t('notNow');
  if (status === 400 || status === 422) return t('rejected');
  return t('serverError', { status });
}

function logRefusal(action: string, status: number, body: string): void {
  console.warn(`campaign tasks ${action}: API answered ${status}: ${body.slice(0, 300)}`);
}

/** Zod's own messages in the interface language. */
async function zodParams() {
  return zodParseParams(await getLocale());
}
