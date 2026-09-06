'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  AccessTierSchema,
  DatasetSlugSchema,
  PublishDatasetVersionRequestSchema,
  type AccessTier,
} from '@oci/shared-types';
import { validate } from '@oci/croissant';
import { auth } from '../../../../auth';
import { isHost } from '../../../../lib/groups';
import {
  describeProvenanceIssue,
  isProvenanceCode,
  type ProvenanceIssue,
} from './provenance-issues';

export interface ManifestIssue {
  /**
   * JSON-pointer-ish path produced by `@oci/croissant`'s validator
   * (e.g. `/distribution/0/contentUrl`). Free-form string; surfaced
   * verbatim in the validation panel.
   */
  path?: string;
  message: string;
  severity?: string;
  /**
   * Stable validator code (`provenance.missing.H5`, `oci.j1.duo…`) when
   * the API included one. The wizard uses it to render `provenance.*`
   * issues in their requirement-id form.
   */
  code?: string;
}

export interface PublishVersionValues {
  version: string;
  notes: string;
  manifest: string;
}

export type PublishVersionState =
  | { status: 'idle' }
  | {
      status: 'error';
      message: string;
      fieldErrors?: ReadonlyMap<string, string>;
      values?: PublishVersionValues;
    }
  | {
      status: 'invalid-manifest';
      message: string;
      conformance: string;
      issues: ManifestIssue[];
      values?: PublishVersionValues;
    };

const FormSchema = z.object({
  slug: DatasetSlugSchema,
  version: PublishDatasetVersionRequestSchema.shape.version,
  notes: z
    .string()
    .max(4000)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  manifest: z.string().min(2, 'paste or upload a Croissant manifest JSON'),
});

/**
 * Server action for `/catalog/<slug>/publish`. Parses the JSON
 * manifest client-side (pre-flight, so we don't waste an API round
 * trip on a syntax error), then POSTs to the API. The API runs the
 * full Croissant 1.1 + RAI + BIOCroissant validator; failures come
 * back as a 400 with `{conformance, issues}` which we surface in the
 * UI as a structured panel rather than a wall of text.
 */
export async function publishVersionAction(
  _prev: PublishVersionState,
  formData: FormData,
): Promise<PublishVersionState> {
  const session = await auth();
  if (!session?.accessToken || !isHost(session)) {
    return { status: 'error', message: 'Only hosts can publish dataset versions.' };
  }

  const raw = {
    slug: String(formData.get('slug') ?? ''),
    version: String(formData.get('version') ?? ''),
    notes: String(formData.get('notes') ?? ''),
    manifest: String(formData.get('manifest') ?? ''),
  };
  const echoed: PublishVersionValues = {
    version: raw.version,
    notes: raw.notes,
    manifest: raw.manifest,
  };

  const parsed = FormSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors = new Map<string, string>();
    for (const issue of parsed.error.issues) {
      const k = String(issue.path[0] ?? '');
      if (k && !fieldErrors.has(k)) fieldErrors.set(k, issue.message);
    }
    return {
      status: 'error',
      message: 'Please correct the errors below.',
      fieldErrors,
      values: echoed,
    };
  }

  let croissant: unknown;
  try {
    croissant = JSON.parse(parsed.data.manifest);
  } catch (err) {
    return {
      status: 'error',
      message: 'Manifest is not valid JSON.',
      fieldErrors: new Map([['manifest', err instanceof Error ? err.message : 'parse error']]),
      values: echoed,
    };
  }

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    return { status: 'error', message: 'NEXT_PUBLIC_API_BASE_URL not set in web env.' };
  }
  const res = await fetch(
    `${base}/v2/catalog/datasets/${encodeURIComponent(parsed.data.slug)}/versions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({
        version: parsed.data.version,
        notes: parsed.data.notes,
        croissant,
      }),
      cache: 'no-store',
    },
  );

  if (res.status === 400) {
    const body = await res.json().catch(() => null);
    if (body && Array.isArray(body.issues)) {
      return {
        status: 'invalid-manifest',
        message: typeof body.message === 'string' ? body.message : 'Manifest validation failed.',
        conformance: typeof body.conformance === 'string' ? body.conformance : 'unknown',
        issues: body.issues as ManifestIssue[],
        values: echoed,
      };
    }
    return {
      status: 'error',
      message:
        typeof body?.message === 'string'
          ? body.message
          : `API 400: ${JSON.stringify(body).slice(0, 300)}`,
      values: echoed,
    };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      status: 'error',
      message: `API ${res.status} ${res.statusText}: ${body.slice(0, 300)}`,
      values: echoed,
    };
  }

  // Bust the detail page's 30s cache so the host sees the new
  // distributions / version they just published — without this the
  // redirect lands on a stale render and misleads "did it work?".
  revalidatePath(`/catalog/${parsed.data.slug}`);
  redirect(`/catalog/${parsed.data.slug}`);
}

// ---- Provenance pre-flight (bio-prov v0.1, #496) --------------------------

export type ProvenancePreflightState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | {
      status: 'checked';
      accessTier: AccessTier;
      /** `provenance.*` issues, strict obligation table applied (spec section 3). */
      issues: ProvenanceIssue[];
      /** Issues from the other layers, verbatim — the API will refuse these. */
      otherErrors: ManifestIssue[];
    };

const PreflightSchema = z.object({
  // Generous cap: the wizard's manifests are a few kilobytes; a paste-form
  // manifest never reaches this action.
  manifest: z.string().min(2).max(1_000_000),
  accessTier: AccessTierSchema,
});

/**
 * Run the `bio-prov` obligations of the dataset's access tier over the
 * wizard's draft manifest, with the table applied **as written** (MUST →
 * error, SHOULD → warning), and return the `provenance.*` issues shaped
 * for inline display. This is advisory: the publish endpoint runs the
 * same validator, strict and with the dataset row's tier (#504), and is
 * what blocks — the wizard only follows that verdict, exactly as it does
 * for the other layers.
 */
export async function preflightProvenanceAction(
  manifestJson: string,
  accessTier: string,
): Promise<ProvenancePreflightState> {
  const session = await auth();
  if (!session?.accessToken || !isHost(session)) {
    return { status: 'error', message: 'Only hosts can publish dataset versions.' };
  }
  const parsed = PreflightSchema.safeParse({ manifest: manifestJson, accessTier });
  if (!parsed.success) {
    return { status: 'error', message: 'Could not check provenance: invalid request.' };
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(parsed.data.manifest);
  } catch {
    return { status: 'error', message: 'Could not check provenance: manifest is not valid JSON.' };
  }

  const tier = parsed.data.accessTier;
  const result = validate(manifest, { accessTier: tier, strictProvenance: true });

  const issues: ProvenanceIssue[] = [];
  const otherErrors: ManifestIssue[] = [];
  for (const issue of result.issues) {
    if (!isProvenanceCode(issue.code)) {
      if (issue.level === 'error') {
        otherErrors.push({
          path: issue.path,
          message: issue.message,
          severity: issue.level,
          code: issue.code,
        });
      }
      continue;
    }
    issues.push(describeProvenanceIssue(issue, tier));
  }

  return { status: 'checked', accessTier: tier, issues, otherErrors };
}

/**
 * Bust the detail-page cache after a host completes a file upload —
 * the upload happens browser → API directly so Next.js never sees it
 * and the 30s `apiFetch` revalidate window leaves the freshly-attached
 * distribution invisible. Called from the FileUploader on `done`.
 */
export async function revalidateDatasetDetail(slug: string): Promise<void> {
  revalidatePath(`/catalog/${slug}`);
}
