'use server';

import { revalidatePath } from 'next/cache';
import {
  CampaignSlugSchema,
  INSTRUCTIONS_MARKDOWN_MAX_BYTES,
  PublishInstructionsRequestSchema,
  type InstructionsMediaRef,
  type PublishInstructionsResponse,
} from '@oci/shared-types';
import { auth } from '../../../../../auth';
import { isCampaignManager } from '../../../../../lib/groups';

/** One media row as typed in the form; every field is a raw string. */
export interface MediaRowValues {
  url: string;
  kind: string;
  caption: string;
}

export interface PublishInstructionsValues {
  markdownBody: string;
  media: MediaRowValues[];
}

export type PublishInstructionsState =
  | { status: 'idle' }
  | {
      status: 'error';
      message: string;
      /** Keyed by form field: `markdownBody`, `media`, `media.<i>.url`, `media.<i>.caption`. */
      fieldErrors?: Record<string, string>;
      values: PublishInstructionsValues;
    }
  | {
      status: 'published';
      version: string;
      /**
       * `new`: a new version was created. `unchanged`: the body matched
       * the current version. `restored`: the body matched an older
       * version, which is current again.
       */
      outcome: 'new' | 'unchanged' | 'restored';
      /**
       * The API keys versions on the markdown body only, so media edits
       * on an unchanged body are not saved. True when that happened.
       */
      mediaIgnored: boolean;
      values: PublishInstructionsValues;
    };

function readValues(formData: FormData): PublishInstructionsValues {
  const urls = formData.getAll('mediaUrl').map(String);
  const kinds = formData.getAll('mediaKind').map(String);
  const captions = formData.getAll('mediaCaption').map(String);
  return {
    markdownBody: String(formData.get('markdownBody') ?? ''),
    media: urls.map((url, i) => ({
      url,
      kind: kinds.at(i) ?? 'image',
      caption: captions.at(i) ?? '',
    })),
  };
}

function toMediaRefs(rows: MediaRowValues[]): unknown[] {
  return rows
    .filter((r) => r.url.trim() !== '' || r.caption.trim() !== '')
    .map((r) => {
      const caption = r.caption.trim();
      return { url: r.url.trim(), kind: r.kind, ...(caption ? { caption } : {}) };
    });
}

function sameMedia(a: InstructionsMediaRef[], b: InstructionsMediaRef[]): boolean {
  const norm = (m: InstructionsMediaRef[]) =>
    JSON.stringify(m.map((r) => [r.url, r.kind, r.caption ?? '']));
  return norm(a) === norm(b);
}

export async function publishInstructionsAction(
  _prev: PublishInstructionsState,
  formData: FormData,
): Promise<PublishInstructionsState> {
  const values = readValues(formData);
  const session = await auth();
  if (!session?.accessToken || !isCampaignManager(session)) {
    return {
      status: 'error',
      message: 'Only campaign managers can publish instructions.',
      values,
    };
  }

  const slug = CampaignSlugSchema.safeParse(formData.get('slug'));
  if (!slug.success) {
    return { status: 'error', message: 'Unknown campaign.', values };
  }
  const previousVersion = String(formData.get('currentVersion') ?? '');

  // Blank rows are dropped, so the mapping from schema index back to
  // form row has to skip them too.
  const keptRows = values.media
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.url.trim() !== '' || r.caption.trim() !== '');
  const parsed = PublishInstructionsRequestSchema.safeParse({
    markdownBody: values.markdownBody,
    mediaUrls: toMediaRefs(values.media),
  });
  if (!parsed.success) {
    const fieldErrors = new Map<string, string>();
    for (const issue of parsed.error.issues) {
      const [head, index, leaf] = issue.path;
      let key: string;
      let message = issue.message;
      if (head === 'markdownBody') {
        key = 'markdownBody';
        message =
          values.markdownBody.length === 0
            ? 'Write the instructions before publishing.'
            : `Instructions must be at most ${INSTRUCTIONS_MARKDOWN_MAX_BYTES.toLocaleString('en-GB')} bytes (64 KB).`;
      } else if (head === 'mediaUrls' && typeof index === 'number') {
        const row = keptRows.at(index)?.i ?? index;
        key = `media.${row}.${leaf === 'caption' ? 'caption' : 'url'}`;
        if (leaf === 'url') message = 'Enter a full URL, starting with https://.';
        if (leaf === 'kind') message = 'Choose image or video.';
        if (leaf === 'caption') message = 'Captions can be at most 200 characters.';
      } else {
        key = 'media';
        message = 'At most 20 media items.';
      }
      if (!fieldErrors.has(key)) fieldErrors.set(key, message);
    }
    return {
      status: 'error',
      message: 'Please correct the errors below.',
      fieldErrors: Object.fromEntries(fieldErrors),
      values,
    };
  }

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    return { status: 'error', message: 'NEXT_PUBLIC_API_BASE_URL not set in web env.', values };
  }
  const res = await fetch(
    `${base}/v2/annotation/campaigns/${encodeURIComponent(slug.data)}/instructions`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify(parsed.data),
      cache: 'no-store',
    },
  );
  if (res.status === 403) {
    return {
      status: 'error',
      message: 'Only campaign managers can publish instructions.',
      values,
    };
  }
  if (!res.ok) {
    // The API logs the detail with a correlation id; don't render it.
    return {
      status: 'error',
      message: 'Could not publish the instructions. Please try again in a moment.',
      values,
    };
  }

  const body = (await res.json()) as PublishInstructionsResponse;
  const { version } = body.instructions;
  const outcome = body.created ? 'new' : version === previousVersion ? 'unchanged' : 'restored';
  revalidatePath(`/annotation/campaigns/${slug.data}/instructions`);
  revalidatePath(`/annotation/campaigns/${slug.data}`);
  return {
    status: 'published',
    version,
    outcome,
    mediaIgnored: !body.created && !sameMedia(parsed.data.mediaUrls, body.instructions.mediaUrls),
    values,
  };
}
