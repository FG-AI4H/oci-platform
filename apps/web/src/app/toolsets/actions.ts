'use server';

import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  ChangeToolsetStatusRequestSchema,
  CreateToolsetRequestSchema,
  ToolsetSlugSchema,
  UpdateToolsetRequestSchema,
  type ToolsetResponse,
} from '@oci/shared-types';
import { zodParseParams } from '../../i18n/zod';
import { fetchAsUser } from '../../lib/api-action';
import { sessionForAction } from '../../lib/session-recovery';
import {
  readToolsetForm,
  toolsetFieldErrors,
  toolsetRequestFromValues,
  unknownLinks,
  type ToolsetFormField,
  type ToolsetFormValues,
} from '../../lib/toolset-form';
import type { ToolsetFormState, ToolsetLifecycleState } from './toolset-action-state';

/**
 * Server actions of the toolset pages (#830, ADR-0031): declare, edit a
 * draft, publish or withdraw. Each request is validated here with the schema
 * the API's pipe uses, so a refusal reaches the field that caused it; the
 * API's own answer stands for everything that depends on who the caller is.
 */

type Translator = Awaited<ReturnType<typeof getTranslations<'ToolsetForm'>>>;

/** The fields the API refused because a named dataset or model is unknown to the caller. */
async function unknownLinkErrors(
  res: Response,
  t: Translator,
): Promise<Map<ToolsetFormField, string>> {
  const unknown = unknownLinks(
    await res
      .clone()
      .json()
      .catch(() => null),
  );
  const errors = new Map<ToolsetFormField, string>();
  if (unknown.datasets.length > 0) {
    errors.set('datasetSlugs', t('errors.unknownDatasets', { slugs: unknown.datasets.join(', ') }));
  }
  if (unknown.modelCards.length > 0) {
    errors.set(
      'modelCardSlugs',
      t('errors.unknownModelCards', { slugs: unknown.modelCards.join(', ') }),
    );
  }
  return errors;
}

async function apiFailure(
  res: Response,
  values: ToolsetFormValues,
  attempt: number,
): Promise<ToolsetFormState> {
  const tCommon = await getTranslations('Common');
  const detail = await res.text().catch(() => '');
  return {
    status: 'error',
    message: tCommon('apiError', {
      status: res.status,
      statusText: res.statusText,
      detail: detail.slice(0, 300),
    }),
    values,
    attempt,
  };
}

/** `/toolsets/new`: any signed-in user declares a toolset; it is saved as a DRAFT. */
export async function declareToolsetAction(
  _prev: ToolsetFormState,
  formData: FormData,
): Promise<ToolsetFormState> {
  const [t, tCommon] = await Promise.all([
    getTranslations('ToolsetForm'),
    getTranslations('Common'),
  ]);
  const values = readToolsetForm(formData);
  const attempt = Date.now();

  const session = await sessionForAction();
  if (!session?.user) {
    return { status: 'error', message: t('errors.signInRequired'), values, attempt };
  }

  const parsed = CreateToolsetRequestSchema.safeParse(
    toolsetRequestFromValues(values),
    zodParseParams(await getLocale()),
  );
  if (!parsed.success) {
    const { fieldErrors, other } = toolsetFieldErrors(parsed.error.issues);
    return {
      status: 'error',
      message: tCommon('correctErrors'),
      fieldErrors,
      otherErrors: other,
      values,
      attempt,
    };
  }

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    return { status: 'error', message: tCommon('apiBaseUrlMissing'), values, attempt };
  }
  const res = await fetchAsUser(
    `${base}/v2/toolsets`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
      cache: 'no-store',
    },
    { returnTo: '/toolsets/new' },
  );
  if (res.status === 409) {
    return {
      status: 'error',
      message: tCommon('correctErrors'),
      fieldErrors: new Map([['slug', t('errors.slugTaken')]]),
      values,
      attempt,
    };
  }
  if (res.status === 400) {
    const fieldErrors = await unknownLinkErrors(res, t);
    if (fieldErrors.size > 0) {
      return { status: 'error', message: tCommon('correctErrors'), fieldErrors, values, attempt };
    }
  }
  if (!res.ok) return apiFailure(res, values, attempt);

  const toolset = (await res.json()) as ToolsetResponse;
  redirect(`/toolsets/${encodeURIComponent(toolset.slug)}`);
}

/**
 * `/toolsets/[slug]/edit`: the declarer edits a DRAFT. The form is validated
 * as a whole toolset (the identifier is its own), then everything but the
 * identifier is sent as a PATCH. The API decides whether the edit is allowed.
 */
export async function updateToolsetAction(
  slug: string,
  _prev: ToolsetFormState,
  formData: FormData,
): Promise<ToolsetFormState> {
  const [t, tCommon] = await Promise.all([
    getTranslations('ToolsetForm'),
    getTranslations('Common'),
  ]);
  const attempt = Date.now();
  const values = { ...readToolsetForm(formData), slug };

  const slugCheck = ToolsetSlugSchema.safeParse(slug);
  if (!slugCheck.success) {
    return { status: 'error', message: t('errors.notFound'), values, attempt };
  }
  const page = `/toolsets/${encodeURIComponent(slugCheck.data)}`;
  await sessionForAction(`${page}/edit`);

  const parsed = CreateToolsetRequestSchema.safeParse(
    toolsetRequestFromValues(values),
    zodParseParams(await getLocale()),
  );
  if (!parsed.success) {
    const { fieldErrors, other } = toolsetFieldErrors(parsed.error.issues);
    return {
      status: 'error',
      message: tCommon('correctErrors'),
      fieldErrors,
      otherErrors: other,
      values,
      attempt,
    };
  }
  const { slug: _slug, ...content } = parsed.data;
  const body = UpdateToolsetRequestSchema.parse(content);

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    return { status: 'error', message: tCommon('apiBaseUrlMissing'), values, attempt };
  }
  const res = await fetchAsUser(
    `${base}/v2/toolsets/${encodeURIComponent(slugCheck.data)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    },
    { returnTo: `${page}/edit` },
  );
  if (res.status === 403 || res.status === 409) {
    return { status: 'error', message: t('notEditable'), values, attempt };
  }
  if (res.status === 404) {
    return { status: 'error', message: t('errors.notFound'), values, attempt };
  }
  if (res.status === 400) {
    const fieldErrors = await unknownLinkErrors(res, t);
    if (fieldErrors.size > 0) {
      return { status: 'error', message: tCommon('correctErrors'), fieldErrors, values, attempt };
    }
  }
  if (!res.ok) return apiFailure(res, values, attempt);
  redirect(page);
}

/**
 * Publish or withdraw from the toolset's page. The page shows only the moves
 * the API said this caller may make; the API checks again and its answer
 * stands. On success the page is reloaded with the new status.
 */
export async function changeToolsetStatusAction(
  _prev: ToolsetLifecycleState,
  formData: FormData,
): Promise<ToolsetLifecycleState> {
  const [t, tCommon] = await Promise.all([
    getTranslations('ToolsetForm'),
    getTranslations('Common'),
  ]);
  const slug = ToolsetSlugSchema.safeParse(formData.get('slug'));
  const move = ChangeToolsetStatusRequestSchema.safeParse({ status: formData.get('status') });
  if (!slug.success || !move.success) {
    return { status: 'error', message: t('lifecycle.invalid') };
  }
  const page = `/toolsets/${encodeURIComponent(slug.data)}`;
  await sessionForAction(page);

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) return { status: 'error', message: tCommon('apiBaseUrlMissing') };

  const res = await fetchAsUser(
    `${base}/v2/toolsets/${encodeURIComponent(slug.data)}/status`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(move.data),
      cache: 'no-store',
    },
    { returnTo: page },
  );
  if (res.status === 403) return { status: 'error', message: t('lifecycle.forbidden') };
  if (res.status === 400 || res.status === 409) {
    return { status: 'error', message: t('lifecycle.stale') };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return {
      status: 'error',
      message: tCommon('apiError', {
        status: res.status,
        statusText: res.statusText,
        detail: detail.slice(0, 300),
      }),
    };
  }
  redirect(page);
}
