'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  CampaignSlugSchema,
  CreateCampaignRequestSchema,
  type CampaignDetail,
  type CampaignOutputLicense,
  type CampaignTaskKind,
} from '@oci/shared-types';
import { fetchAsUser } from '../../../../lib/api-action';
import { parseLabelLines } from '../../../../lib/campaign-labels';
import { isCampaignManager } from '../../../../lib/groups';
import { sessionForAction } from '../../../../lib/session-recovery';

export interface CreateCampaignValues {
  slug: string;
  name: string;
  description: string;
  datasetId: string;
  toolIntegrationId: string;
  taskKind: string;
  nAnnotators: string;
  outputLicense: string;
  /** Feeds the cost estimate only (#311); echoed back, never sent to the API. */
  expectedSamples: string;
  /** CLASSIFICATION only (#646): one label per line. */
  labels: string;
  cannotAssess: boolean;
  allowComment: boolean;
}

export type CreateCampaignState =
  | { status: 'idle' }
  | {
      status: 'error';
      message: string;
      fieldErrors?: ReadonlyMap<string, string>;
      values?: CreateCampaignValues;
    };

/**
 * The HTML form ships `nAnnotators` as a string and may omit the
 * optional fields. Coerce + reshape into the API contract before
 * Zod validation so we surface field-level messages against the
 * UI fields the user can see.
 */
const FormSchema = CreateCampaignRequestSchema.extend({
  description: z
    .string()
    .max(2000)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
});

export async function createCampaignAction(
  _prev: CreateCampaignState,
  formData: FormData,
): Promise<CreateCampaignState> {
  const session = await sessionForAction();
  if (!session?.user || !isCampaignManager(session)) {
    return { status: 'error', message: 'Only campaign managers can create campaigns.' };
  }

  const raw: CreateCampaignValues = {
    slug: String(formData.get('slug') ?? ''),
    name: String(formData.get('name') ?? ''),
    description: String(formData.get('description') ?? ''),
    datasetId: String(formData.get('datasetId') ?? ''),
    toolIntegrationId: String(formData.get('toolIntegrationId') ?? ''),
    taskKind: String(formData.get('taskKind') ?? ''),
    nAnnotators: String(formData.get('nAnnotators') ?? '3'),
    outputLicense: String(formData.get('outputLicense') ?? 'CC-BY-4.0'),
    expectedSamples: String(formData.get('expectedSamples') ?? ''),
    labels: String(formData.get('labels') ?? ''),
    cannotAssess: formData.get('cannotAssess') === 'on',
    allowComment: formData.get('allowComment') === 'on',
  };

  const nAnnotators = Number.parseInt(raw.nAnnotators, 10);

  const parsed = FormSchema.safeParse({
    slug: raw.slug,
    name: raw.name,
    description: raw.description,
    datasetId: raw.datasetId,
    toolIntegrationId: raw.toolIntegrationId,
    taskKind: raw.taskKind as CampaignTaskKind,
    workflowConfig: {
      nAnnotators: Number.isFinite(nAnnotators) ? nAnnotators : 0,
      // A CLASSIFICATION campaign declares its answers at creation (#646).
      ...(raw.taskKind === 'CLASSIFICATION'
        ? {
            classificationLabels: {
              labels: parseLabelLines(raw.labels),
              cannotAssess: raw.cannotAssess,
              allowComment: raw.allowComment,
            },
          }
        : {}),
    },
    outputLicense: raw.outputLicense as CampaignOutputLicense,
  });
  if (!parsed.success) {
    const fieldErrors = new Map<string, string>();
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.');
      // Map nested workflowConfig paths back to the flat form fields.
      const field =
        path === 'workflowConfig.nAnnotators'
          ? 'nAnnotators'
          : path.startsWith('workflowConfig.classificationLabels')
            ? 'labels'
            : (issue.path[0] ?? '');
      const key = String(field);
      const message =
        key === 'labels' && issue.path.length > 3
          ? `Label ${Number(issue.path[3]) + 1}: ${issue.message}`
          : issue.message;
      if (key && !fieldErrors.has(key)) fieldErrors.set(key, message);
    }
    return {
      status: 'error',
      message: 'Please correct the errors below.',
      fieldErrors,
      values: raw,
    };
  }

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    return { status: 'error', message: 'NEXT_PUBLIC_API_BASE_URL not set in web env.' };
  }
  const res = await fetchAsUser(`${base}/v2/annotation/campaigns`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(parsed.data),
    cache: 'no-store',
  });

  if (res.status === 409) {
    return {
      status: 'error',
      message: `Slug "${parsed.data.slug}" is already taken.`,
      fieldErrors: new Map([['slug', 'taken']]),
      values: raw,
    };
  }
  if (res.status === 400) {
    const body = await res.text().catch(() => '');
    return {
      status: 'error',
      message: `Validation failed: ${body.slice(0, 300)}`,
      values: raw,
    };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      status: 'error',
      message: `API ${res.status} ${res.statusText}: ${body.slice(0, 300)}`,
      values: raw,
    };
  }

  const created = (await res.json()) as CampaignDetail;
  const slugCheck = CampaignSlugSchema.safeParse(created.slug);
  if (!slugCheck.success) {
    return { status: 'error', message: 'API returned an unexpected campaign shape.' };
  }
  redirect(`/annotation/campaigns/${slugCheck.data}`);
}
