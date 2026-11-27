'use server';

import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  CreateModelCardRequestSchema,
  ModelCardSlugSchema,
  UpdateModelCardRequestSchema,
  type ModelCardResponse,
} from '@oci/shared-types';
import { zodParseParams } from '../../../../i18n/zod';
import { fetchAsUser } from '../../../../lib/api-action';
import {
  editBodyFrom,
  fieldErrorsFromIssues,
  modelCardRequestFromValues,
  readModelCardForm,
  unknownDatasetRows,
} from '../../../../lib/model-card-form';
import { sessionForAction } from '../../../../lib/session-recovery';
import type { ModelCardFormState } from '../../model-card-action-state';

/**
 * `/models/[slug]/edit` (#651): save changes to a DRAFT card.
 *
 * The form is validated as a whole card with `CreateModelCardRequestSchema`
 * (the slug is the card's own, not editable), then the fields the form owns
 * are sent as `PATCH /v2/prediction/model-cards/:slug`, checked again with
 * `UpdateModelCardRequestSchema`. The API decides whether the edit is
 * allowed (DRAFT, submitter): a 403 or 409 comes back as a message, with the
 * values kept.
 *
 * The card is read first to keep the training-data lineage entries the form
 * does not show.
 */
export async function updateModelCardAction(
  slug: string,
  _prev: ModelCardFormState,
  formData: FormData,
): Promise<ModelCardFormState> {
  const [t, tCommon] = await Promise.all([
    getTranslations('ModelCardForm'),
    getTranslations('Common'),
  ]);
  const attempt = Date.now();
  const values = { ...readModelCardForm(formData), slug };

  const slugCheck = ModelCardSlugSchema.safeParse(slug);
  if (!slugCheck.success) {
    return { status: 'error', message: t('errors.notFound'), values, attempt };
  }
  const returnTo = `/models/${encodeURIComponent(slug)}/edit`;
  await sessionForAction(returnTo);

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    return { status: 'error', message: tCommon('apiBaseUrlMissing'), values, attempt };
  }
  const cardUrl = `${base}/v2/prediction/model-cards/${encodeURIComponent(slugCheck.data)}`;

  const current = await fetchAsUser(cardUrl, { cache: 'no-store' }, { returnTo });
  if (!current.ok) {
    return {
      status: 'error',
      message: current.status === 404 ? t('errors.notFound') : t('errors.notEditable'),
      values,
      attempt,
    };
  }
  const existing = (await current.json()) as Partial<ModelCardResponse>;

  const locale = await getLocale();
  const parsed = CreateModelCardRequestSchema.safeParse(
    modelCardRequestFromValues(values, existing.trainingDataLineage ?? {}),
    zodParseParams(locale),
  );
  if (!parsed.success) {
    const { fieldErrors, datasetRefErrors, other } = fieldErrorsFromIssues(parsed.error.issues);
    return {
      status: 'error',
      message: tCommon('correctErrors'),
      fieldErrors,
      datasetRefErrors,
      otherErrors: other,
      values,
      attempt,
    };
  }
  const body = UpdateModelCardRequestSchema.parse(editBodyFrom(parsed.data));

  const res = await fetchAsUser(
    cardUrl,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    },
    { returnTo },
  );
  if (res.status === 403 || res.status === 409) {
    return { status: 'error', message: t('errors.notEditable'), values, attempt };
  }
  if (res.status === 404) {
    return { status: 'error', message: t('errors.notFound'), values, attempt };
  }
  if (res.status === 400) {
    // A dataset row names something the catalogue does not show this user (#820).
    const rows = unknownDatasetRows(
      values,
      await res
        .clone()
        .json()
        .catch(() => null),
    );
    if (rows.length > 0) {
      const text = t('errors.datasetUnknown');
      return {
        status: 'error',
        message: tCommon('correctErrors'),
        fieldErrors: new Map([['datasetRefs', text]]),
        datasetRefErrors: new Map(rows.map((row) => [row, text])),
        values,
        attempt,
      };
    }
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
      values,
      attempt,
    };
  }
  redirect(`/models/${encodeURIComponent(slugCheck.data)}`);
}
