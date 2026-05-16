'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { MaintenanceBannerToneSchema, type PlatformSettings } from '@oci/shared-types';
import { auth } from '../../../auth';
import { isAdmin } from '../../../lib/groups';

export interface UpdateSettingsValues {
  bannerEnabled: 'on' | '';
  bannerMessage: string;
  bannerTone: string;
  bannerVisibleFrom: string;
  bannerVisibleUntil: string;
}

export type UpdateSettingsState =
  | { status: 'idle' }
  | { status: 'success'; message: string }
  | {
      status: 'error';
      message: string;
      fieldErrors?: ReadonlyMap<string, string>;
      values?: UpdateSettingsValues;
    };

/**
 * Validates the admin settings form and forwards to
 * `PUT /v2/admin/settings`. The form ships a single block of banner
 * fields; we either send a `maintenanceBanner` object or `null`
 * depending on whether the "Show banner" toggle is on.
 */
export async function updateSettingsAction(
  _prev: UpdateSettingsState,
  formData: FormData,
): Promise<UpdateSettingsState> {
  const session = await auth();
  if (!session?.accessToken || !isAdmin(session)) {
    return { status: 'error', message: 'Only admins can update settings.' };
  }

  const raw: UpdateSettingsValues = {
    bannerEnabled: formData.get('bannerEnabled') === 'on' ? 'on' : '',
    bannerMessage: String(formData.get('bannerMessage') ?? ''),
    bannerTone: String(formData.get('bannerTone') ?? 'info'),
    bannerVisibleFrom: String(formData.get('bannerVisibleFrom') ?? ''),
    bannerVisibleUntil: String(formData.get('bannerVisibleUntil') ?? ''),
  };

  let body: PlatformSettings;
  const fieldErrors = new Map<string, string>();
  if (raw.bannerEnabled !== 'on') {
    body = { maintenanceBanner: null };
  } else {
    if (raw.bannerMessage.length === 0) fieldErrors.set('bannerMessage', 'required');
    if (raw.bannerMessage.length > 280) fieldErrors.set('bannerMessage', 'too long (max 280)');
    const toneParse = MaintenanceBannerToneSchema.safeParse(raw.bannerTone);
    if (!toneParse.success) fieldErrors.set('bannerTone', 'invalid');
    const from = toIsoFromLocalDatetime(raw.bannerVisibleFrom);
    const until = toIsoFromLocalDatetime(raw.bannerVisibleUntil);
    if (!from) fieldErrors.set('bannerVisibleFrom', 'invalid datetime');
    if (!until) fieldErrors.set('bannerVisibleUntil', 'invalid datetime');
    if (from && until && new Date(from).getTime() >= new Date(until).getTime()) {
      fieldErrors.set('bannerVisibleUntil', 'must be after "visible from"');
    }
    if (fieldErrors.size > 0) {
      return {
        status: 'error',
        message: 'Please correct the errors below.',
        fieldErrors,
        values: raw,
      };
    }
    body = {
      maintenanceBanner: {
        message: raw.bannerMessage,
        tone: toneParse.success ? toneParse.data : 'info',
        // safe: presence asserted above
        visibleFrom: from!,
        visibleUntil: until!,
      },
    };
  }

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    return { status: 'error', message: 'NEXT_PUBLIC_API_BASE_URL not set in web env.' };
  }

  const res = await fetch(`${base}/v2/admin/settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  if (!res.ok) {
    const respBody = await res.text().catch(() => '');
    return {
      status: 'error',
      message: `API ${res.status} ${res.statusText}: ${respBody.slice(0, 200)}`,
      values: raw,
    };
  }

  // Revalidate `/admin/settings` so the form re-renders with the new
  // metadata, and `/` so the SiteHeader picks up a new banner shape.
  revalidatePath('/admin/settings');
  revalidatePath('/', 'layout');

  return {
    status: 'success',
    message: raw.bannerEnabled === 'on' ? 'Banner saved.' : 'Banner cleared.',
  };
}

/**
 * `<input type="datetime-local">` emits values like `2026-05-16T14:00`
 * — no seconds, no timezone. Interpret as UTC and serialise as
 * Zod-friendly ISO.
 */
function toIsoFromLocalDatetime(v: string): string | null {
  if (!v) return null;
  const parsed = z
    .string()
    // eslint-disable-next-line security/detect-unsafe-regex -- anchored, fixed quantifiers; no catastrophic backtracking
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/)
    .safeParse(v);
  if (!parsed.success) return null;
  // Append seconds + Z to coerce into ISO datetime.
  const withSeconds = parsed.data.length === 16 ? `${parsed.data}:00` : parsed.data;
  return `${withSeconds}.000Z`;
}
