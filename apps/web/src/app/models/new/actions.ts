'use server';

import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { CreateModelCardRequestSchema, type ModelCardResponse } from '@oci/shared-types';
import { zodParseParams } from '../../../i18n/zod';
import { fetchAsUser } from '../../../lib/api-action';
import {
  fieldErrorsFromIssues,
  modelCardRequestFromValues,
  readModelCardForm,
} from '../../../lib/model-card-form';
import { sessionForAction } from '../../../lib/session-recovery';
import type { ModelCardFormState } from '../model-card-action-state';

/**
 * `/models/new` (#651): declare a model. Any signed-in user may, as on the
 * API (`POST /v2/prediction/model-cards` is behind sign-in only); the card
 * is saved as a DRAFT that only its submitter and reviewers can see.
 *
 * The request is validated with `CreateModelCardRequestSchema`, the schema
 * the API's pipe uses, and the risk tier in it is derived from the answers
 * (`modelCardRequestFromValues`), never typed by the user. On success the
 * browser goes to the card's page, which shows its status and next step.
 */
export async function createModelCardAction(
  _prev: ModelCardFormState,
  formData: FormData,
): Promise<ModelCardFormState> {
  const [t, tCommon] = await Promise.all([
    getTranslations('ModelCardForm'),
    getTranslations('Common'),
  ]);
  const values = readModelCardForm(formData);
  const attempt = Date.now();

  const session = await sessionForAction();
  if (!session?.user) {
    return { status: 'error', message: t('errors.signInRequired'), values, attempt };
  }

  const parsed = CreateModelCardRequestSchema.safeParse(
    modelCardRequestFromValues(values),
    zodParseParams(await getLocale()),
  );
  if (!parsed.success) {
    const { fieldErrors, other } = fieldErrorsFromIssues(parsed.error.issues);
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
    `${base}/v2/prediction/model-cards`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
      cache: 'no-store',
    },
    { returnTo: '/models/new' },
  );

  if (res.status === 409) {
    return {
      status: 'error',
      message: t('errors.slugTaken', { slug: parsed.data.slug }),
      fieldErrors: new Map([['slug', t('errors.slugTakenField')]]),
      values,
      attempt,
    };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      status: 'error',
      message: tCommon('apiError', {
        status: res.status,
        statusText: res.statusText,
        detail: body.slice(0, 300),
      }),
      values,
      attempt,
    };
  }

  const card = (await res.json()) as ModelCardResponse;
  redirect(`/models/${encodeURIComponent(card.slug)}`);
}
