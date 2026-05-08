'use server';

import { redirect } from 'next/navigation';
import {
  CreateAccessRequestRequestSchema,
  audienceFromIntendedUse,
  safeClassifyEmailDomain,
} from '@oci/shared-types';
import { auth } from '../../../../auth';

export interface RequestAccessValues {
  projectTitle: string;
  projectDescription: string;
  institution: string;
  intendedUseCategory: string;
  intendedUseDuoTerms: string[];
  irbApproved: string;
  irbApprovalRef: string;
  dpiaRef: string;
  dataRetentionDays: string;
  redistributionIntent: string;
  outputType: string;
  // Builder-only fields (#120). Empty strings when audience=RESEARCHER.
  legalEntityName: string;
  legalEntityCountry: string;
  deploymentCountries: string;
  regulatoryPathway: string;
  whoPriorityAlignment: string;
  accreditations: string;
  royaltyPlan: string;
  postMarketDataFlow: string;
}

export type RequestAccessState =
  | { status: 'idle' }
  | {
      status: 'error';
      message: string;
      fieldErrors?: ReadonlyMap<string, string>;
      values?: RequestAccessValues;
    };

/**
 * Server action: POST /v2/catalog/datasets/:slug/access-requests on
 * behalf of the authenticated caller. Validates with the same Zod
 * schema the API uses, then forwards. The API runs the DUO matcher +
 * persists matchStatus; on success we redirect to the requester's
 * dashboard which shows the badge.
 */
export async function requestAccessAction(
  slug: string,
  _prev: RequestAccessState,
  formData: FormData,
): Promise<RequestAccessState> {
  const session = await auth();
  if (!session?.accessToken) {
    return { status: 'error', message: 'Sign in required.' };
  }

  // Disposable-email guard (#116). Form-side rejection so requesters
  // get an immediate, specific error instead of a generic API 4xx.
  // The API will land its own copy of this check in #115 (tier
  // scoring) where the User-table email lookup is added; this is
  // defense-in-depth, not the only line.
  const requesterEmail = typeof session.user?.email === 'string' ? session.user.email : null;
  if (requesterEmail) {
    const classification = safeClassifyEmailDomain(requesterEmail);
    if (classification?.category === 'disposable') {
      return {
        status: 'error',
        message: `Requests from disposable email providers are not accepted (${classification.domain}). Please use an institutional or organisational address.`,
      };
    }
  }

  const raw: RequestAccessValues = {
    projectTitle: String(formData.get('projectTitle') ?? ''),
    projectDescription: String(formData.get('projectDescription') ?? ''),
    institution: String(formData.get('institution') ?? ''),
    intendedUseCategory: String(formData.get('intendedUseCategory') ?? ''),
    // Multi-select via repeated checkbox name. FormData.getAll returns
    // every value with the matching name.
    intendedUseDuoTerms: formData.getAll('intendedUseDuoTerms').map(String),
    irbApproved: String(formData.get('irbApproved') ?? ''),
    irbApprovalRef: String(formData.get('irbApprovalRef') ?? ''),
    dpiaRef: String(formData.get('dpiaRef') ?? ''),
    dataRetentionDays: String(formData.get('dataRetentionDays') ?? ''),
    redistributionIntent: String(formData.get('redistributionIntent') ?? ''),
    outputType: String(formData.get('outputType') ?? ''),
    legalEntityName: String(formData.get('legalEntityName') ?? ''),
    legalEntityCountry: String(formData.get('legalEntityCountry') ?? ''),
    deploymentCountries: String(formData.get('deploymentCountries') ?? ''),
    regulatoryPathway: String(formData.get('regulatoryPathway') ?? ''),
    whoPriorityAlignment: String(formData.get('whoPriorityAlignment') ?? ''),
    accreditations: String(formData.get('accreditations') ?? ''),
    royaltyPlan: String(formData.get('royaltyPlan') ?? ''),
    postMarketDataFlow: String(formData.get('postMarketDataFlow') ?? ''),
  };

  // Audience derivation (#120). Determines whether builderContext is
  // required (BUILDER) or forbidden (RESEARCHER). The `audienceFromIntendedUse`
  // helper is shared with the API so the two layers can't drift.
  const intendedUseTyped =
    raw.intendedUseCategory === 'NON_COMMERCIAL_RESEARCH' ||
    raw.intendedUseCategory === 'COMMERCIAL_RESEARCH' ||
    raw.intendedUseCategory === 'CLINICAL_CARE' ||
    raw.intendedUseCategory === 'EDUCATION'
      ? raw.intendedUseCategory
      : null;
  const audience =
    intendedUseTyped !== null ? audienceFromIntendedUse(intendedUseTyped) : 'RESEARCHER';
  const isBuilder = audience === 'BUILDER';

  const builderContext = isBuilder
    ? {
        legalEntity: {
          name: raw.legalEntityName,
          jurisdictionCountry: raw.legalEntityCountry.toUpperCase(),
        },
        deploymentCountries: raw.deploymentCountries
          .split(/[,\s]+/)
          .map((c) => c.trim().toUpperCase())
          .filter((c) => c.length > 0),
        regulatoryPathway: raw.regulatoryPathway,
        whoPriorityAlignment: raw.whoPriorityAlignment.length > 0 ? raw.whoPriorityAlignment : null,
        accreditations: raw.accreditations
          .split('\n')
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
        royaltyPlan: raw.royaltyPlan.length > 0 ? raw.royaltyPlan : null,
        postMarketDataFlow: raw.postMarketDataFlow,
      }
    : null;

  const candidate = {
    attestations: {
      v: 1 as const,
      projectTitle: raw.projectTitle,
      projectDescription: raw.projectDescription,
      institution: raw.institution,
      intendedUseCategory: raw.intendedUseCategory,
      intendedUseDuoTerms: raw.intendedUseDuoTerms,
      irbApproved: raw.irbApproved === 'true' || raw.irbApproved === 'on',
      irbApprovalRef: raw.irbApprovalRef.length > 0 ? raw.irbApprovalRef : null,
      dpiaRef: raw.dpiaRef.length > 0 ? raw.dpiaRef : null,
      dataRetentionDays:
        raw.dataRetentionDays.length > 0 ? Number(raw.dataRetentionDays) : Number.NaN,
      redistributionIntent: raw.redistributionIntent,
      outputType: raw.outputType,
    },
    builderContext,
  };

  const parsed = CreateAccessRequestRequestSchema.safeParse(candidate);
  if (!parsed.success) {
    const fieldErrors = new Map<string, string>();
    for (const issue of parsed.error.issues) {
      // Surface attestation issues under the leaf field name so the
      // form can highlight them; surface top-level issues under their
      // own key.
      const path = issue.path;
      const key =
        path.length === 0
          ? '_form'
          : path[path.length - 1] !== undefined
            ? String(path[path.length - 1])
            : '_form';
      if (!fieldErrors.has(key)) fieldErrors.set(key, issue.message);
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
  const res = await fetch(
    `${base}/v2/catalog/datasets/${encodeURIComponent(slug)}/access-requests`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify(parsed.data),
      cache: 'no-store',
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      status: 'error',
      message: `API ${res.status} ${res.statusText}: ${body.slice(0, 300)}`,
      values: raw,
    };
  }

  // Land back on the dataset detail page with a confirmation banner.
  // The CTA there is already status-aware, so the user sees their
  // request transition to PENDING inline — and the "View in dashboard"
  // link in that panel is the path forward to the full list.
  redirect(`/catalog/${encodeURIComponent(slug)}?requested=1`);
}
