import type { PublicBannerResponse } from '@oci/shared-types';

/**
 * Public-facing maintenance banner (#242). Server component, rendered
 * above the `SiteHeader` so it floats at the very top of every page.
 *
 * Fetches the public banner endpoint with a 60-second cache; the
 * action that updates the banner calls `revalidatePath('/', 'layout')`
 * so a freshly-set banner shows up immediately even though the
 * normal cache is 60s.
 *
 * The endpoint hides the banner when `now` is outside the
 * visible-from / visible-until window, so the client receives null
 * for inactive banners — no time-zone logic needed here.
 */
export async function MaintenanceBanner() {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) return null;

  let banner: PublicBannerResponse['banner'] = null;
  try {
    const res = await fetch(`${base}/v2/platform-settings/banner`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as PublicBannerResponse;
    banner = body.banner;
  } catch {
    return null;
  }

  if (!banner) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`w-full border-b px-4 py-2 text-sm text-center font-medium ${toneClass(banner.tone)}`}
    >
      {banner.message}
    </div>
  );
}

function toneClass(tone: 'info' | 'warning' | 'danger'): string {
  switch (tone) {
    case 'info':
      return 'bg-[var(--color-primary-soft)] text-[var(--color-foreground)] border-[var(--color-primary)]';
    case 'warning':
      return 'bg-[var(--color-warning-soft)] text-[var(--color-foreground)] border-[var(--color-warning)]';
    case 'danger':
      return 'bg-[var(--color-danger-soft)] text-[var(--color-foreground)] border-[var(--color-danger)]';
  }
}
