/**
 * Returns the canonical public-facing URL of the web app, with no
 * trailing slash. Drives `metadataBase`, JSON-LD `@id` / `url`,
 * sitemap entries, and robots policy.
 *
 * `NEXT_PUBLIC_SITE_URL` is set per environment (dev / int / prod) by
 * the CDK web-stack outputs and read by Server Components at runtime.
 * If it is missing — which only happens during `next build` in CI
 * before deploy — we fall back to a placeholder so the build doesn't
 * fail at page-data collection. The real value is read at runtime
 * inside the container, so the placeholder never reaches a real
 * response on dev/int/prod.
 *
 * Locally, `.env.local` sets it to `http://localhost:3001`.
 */
const BUILD_FALLBACK = 'http://localhost:3001';

export function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL ?? BUILD_FALLBACK;
  return raw.replace(/\/+$/, '');
}
